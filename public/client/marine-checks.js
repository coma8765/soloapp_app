// Exercise the actual application, GLB animations, world picking and XR ray conversion.
const output = document.getElementById('results');
const log = message => { output.textContent += '\n' + message; };
function check(condition, description) {
  if (!condition) throw Error(description);
  log('PASS · ' + description);
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const win = document.getElementById('game').contentWindow;
  for (let i = 0; i < 300 && !win.planetApp; i++) await delay(100);
  const app = win.planetApp;
  if (!app) throw Error('Игра не загрузилась за 30 секунд');
  const { marine, scene, planet, player, authPanel, gamepad, xr, engine } = app;
  const B = win.BABYLON;
  engine.stopRenderLoop();
  app.quality.high = false; app.quality.apply();
  planet.grass.setEnabled(false); planet.leaves.setEnabled(false); planet.shadowMap.renderList = [];
  check(await marine.ready, 'Обе GLB-модели загружены без ошибок');
  check(marine.entities.length === 16, 'В четырёх озёрах по три рыбы-клоуна и одному омару');
  check(marine.entities.every(e => e.entries.animationGroups.length && e.entries.skeletons.length), 'Сохранены скелеты и анимации всех животных');
  win.document.getElementById('auth-dialog').close();
  win.document.getElementById('welcome').hidden = true;
  authPanel.sync(); player.overview = false; gamepad.active = false;
  const camera = scene.activeCamera;
  function aim(entity) {
    camera.position.copyFrom(marine.point(entity.lake, 0, 5, 1.65));
    camera.upVector.copyFrom(camera.position.normalizeToNew());
    camera.setTarget(entity.anchor()); camera.computeWorldMatrix(true);
    marine.update(0); scene.render();
  }
  for (const lake of marine.lakes) {
    const inhabitants = marine.entities.filter(e => e.lake === lake);
    aim(inhabitants[0]);
    check(inhabitants.every(e => e.active && e.root.isEnabled()), 'Жители озера ' + (lake.index + 1) + ' видимы вблизи');
    check(inhabitants.every(e => e.root.position.length() < 36.8 && e.root.position.length() > app.terrain.radius(e.root.position.asArray())), 'Жители озера ' + (lake.index + 1) + ' находятся между дном и водой');
  }
  for (const id of ['clownfish', 'lobster']) {
    const entity = marine.entities.find(e => e.lakeIndex === 0 && e.species.id === id);
    aim(entity);
    const direction = entity.anchor().subtract(camera.globalPosition).normalize();
    check(marine.pick(new B.Ray(camera.globalPosition.clone(), direction, 18)) === entity, 'Луч выбирает модель ' + id);
    const rect = marine.canvas.getBoundingClientRect();
    marine.pointer = { x: rect.width / 2, y: rect.height / 2 };
    marine.update(0); await delay(150); marine.update(0);
    check(marine.card.entity === entity && marine.card.mesh.isEnabled(), 'Наведение мышью открывает карточку ' + id);
    check(marine.card.contentBottom < 1160, 'Описание ' + id + ' помещается без наложения на источники');
    check(win.document.getElementById('marine-description').textContent.includes(entity.species.name), 'Описание ' + id + ' доступно для чтения с экрана');
    marine.pointer = null;
    await delay(1150); marine.update(0);
    check(!marine.card.entity && !marine.card.mesh.isEnabled(), 'Карточка ' + id + ' исчезает после отвода курсора');
    gamepad.active = true;
    marine.update(0); await delay(150); marine.update(0);
    check(marine.card.entity === entity, 'Прицел геймпада выбирает ' + id);
    gamepad.active = false;
    const origin = new B.TransformNode('Test XR origin', scene);
    const q = camera.absoluteRotation;
    const frame = { session: { inputSources: [{ targetRaySpace: {} }] }, getPose: () => ({ transform: { position: camera.globalPosition, orientation: q } }) };
    marine.updateXR(frame, {}, origin);
    check(marine.xrTarget === entity, 'VR targetRaySpace выбирает ' + id);
    xr.active = true; marine.update(0);
    check(marine.card.entity === entity, 'VR показывает ту же 3D-карточку ' + id);
    xr.active = false; origin.dispose();
    scene.render();
  }
  const entity = marine.entities[0]; aim(entity);
  const before = entity.root.position.clone(); marine.update(.2);
  check(B.Vector3.Distance(before, entity.root.position) > .001 && entity.entries.animationGroups.every(group => group.isPlaying), 'Животное движется, встроенная анимация запущена');
  const inside = entity.root.position.normalizeToNew().scale(30);
  check(!marine.pick(new B.Ray(inside, entity.anchor().subtract(inside).normalize(), 18)), 'Рельеф перекрывает выбор животного сквозь дно');
  marine.inspect(entity); win.document.getElementById('auth-dialog').showModal(); authPanel.sync(); marine.update(0);
  check(!marine.card.entity, 'Меню закрывает временную карточку');
  win.document.getElementById('auth-dialog').close(); authPanel.sync(); marine.inspect(entity);
  app.room.enter({ id: 'marine-check', members: [{ id: 1, spawn_slot: 0 }] }, 1); marine.update(0);
  check(!marine.card.entity && marine.entities.every(e => !e.root.isEnabled()) && marine.exhibits.every(e => !e.root.isEnabled()), 'В другом мире скрыты жители, декорации и карточка');
  check(marine.entities.every(e => e.entries.animationGroups.every(group => !group.isPlaying)), 'Анимации скрытых животных приостановлены');
  app.room.leave(); aim(entity);
  check(entity.root.isEnabled(), 'При возвращении на планету жители появляются снова');
  log('\nВсе проверки морских жителей пройдены. Физический VR-шлем проверяется отдельно.');
  window.marineChecksPassed = true;
} catch (error) {
  log('FAIL · ' + (error?.message || String(error)));
  console.error(error);
}
