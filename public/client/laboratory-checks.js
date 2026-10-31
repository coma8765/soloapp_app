const output = document.getElementById('results');
function check(condition, description) {
  if (!condition) throw Error(description);
  output.textContent += '\nPASS · ' + description;
}
try {
  const win = document.getElementById('game').contentWindow;
  for (let i = 0; i < 300 && !win.planetApp; i++) await new Promise(resolve => setTimeout(resolve, 100));
  const app = win.planetApp;
  if (!app) throw Error('Игра не загрузилась за 30 секунд');
  const { laboratory: lab, player, engine, scene, planet } = app, B = win.BABYLON;
  engine.stopRenderLoop();
  check(await lab.ready, 'Лабораторная веранда создана');
  lab.update(lab.root.position);
  await app.marine.ready;
  app.quality.high = false; app.quality.apply();
  planet.grass.setEnabled(false); planet.leaves.setEnabled(false); planet.shadowMap.renderList = [];
  win.document.getElementById('auth-dialog').close(); win.document.getElementById('welcome').hidden = true; app.authPanel.sync();
  player.inputEnabled = true; player.overview = false; player.third = false;
  check(lab.tables.length === 2 && lab.vessels.length === 2, 'Два стола и ровно две пробирки');
  check(lab.site.position.every(Number.isFinite) && lab.site.base > 36.8, 'Размещение над сухим берегом');
  const world = lab.root.computeWorldMatrix(true);
  const point = (x, y, z) => B.Vector3.TransformCoordinates(new B.Vector3(x, y, z), world);
  const back = B.Vector3.TransformNormal(B.Axis.Z, world).normalize();
  check(planet.trees.every(tree => { const p = lab.localPosition(tree); return Math.abs(p.x) >= 4.2 || p.z <= -6.4 || p.z >= 3.4 || p.y < -8; }), 'Веранда и вход свободны от стволов');
  check(app.professors.guides.every(g => { const p = lab.localPosition(g.root.position); return Math.abs(p.x) >= 4.2 || p.z <= -6.4 || p.z >= 3.4 || p.y < -8; }), 'Размещение не перекрывает профессоров');
  for (const xr of [false, true]) {
    const start = point(0, 0, -6.2).normalize();
    player.position = start.scale(app.terrain.radius(start.asArray()) + .06);
    player.forward.copyFrom(back); player.radialSpeed = 0; player.xr = xr;
    player.gamepadMove = xr ? null : { x: 0, y: 1 };
    let maxStep = 0;
    for (let frame = 0; frame < 240 && lab.localPosition(player.position).z < -.6; frame++) {
      const before = player.position.clone(); player.update(1 / 60, xr ? back : null);
      maxStep = Math.max(maxStep, B.Vector3.Distance(before, player.position));
    }
    const p = lab.localPosition(player.position);
    check(p.z > -.7 && p.y > .03 && p.y < .15, (xr ? 'VR' : 'Геймпад') + ': проход по пандусу на настил без проваливания');
    check(maxStep < .18, (xr ? 'VR' : 'Геймпад') + ': нет скачка позиции на стыке земли и пандуса');
  }
  player.xr = false; player.position = point(-1.65, .06, -.8); player.forward.copyFrom(back); player.gamepadMove = { x: 0, y: 1 };
  for (let i = 0; i < 90; i++) player.update(1 / 60);
  check(lab.localPosition(player.position).z < -.09, 'Игрок не проходит сквозь рабочий стол');
  player.position = point(2.8, .06, -1); player.forward.copyFrom(B.Vector3.TransformNormal(B.Axis.X, world));
  for (let i = 0; i < 90; i++) player.update(1 / 60);
  check(lab.localPosition(player.position).x < 3.1, 'Ограждение удерживает игрока на настиле');
  player.gamepadMove = null;
  for (const vessel of lab.vessels) {
    check(vessel.root.parent === lab.root && vessel.contents.length === 1 && vessel.contents[0].volumeMl < vessel.capacityMl, vessel.id + ': самостоятельный объект с содержимым и ёмкостью');
    vessel.pickMesh.computeWorldMatrix(true);
    const target = vessel.pickMesh.getAbsolutePosition().clone(), start = target.subtract(back.scale(.8));
    const hit = scene.pickWithRay(new B.Ray(start, back, 1), mesh => mesh.metadata?.kind === 'lab-vessel' && mesh.isEnabled());
    check(hit?.pickedMesh?.metadata?.vesselId === vessel.id, vessel.id + ': отдельная зона выбора лучом');
    const saved = vessel.root.position.clone(); vessel.root.position.y += .2; vessel.pickMesh.computeWorldMatrix(true);
    check(B.Vector3.Distance(target, vessel.pickMesh.getAbsolutePosition()) > .19, vessel.id + ': стекло и зона выбора перемещаются вместе');
    vessel.root.position.copyFrom(saved);
  }
  check(lab.vessels[0].contents[0].color !== lab.vessels[1].contents[0].color, 'У двух образцов разные цвета');
  app.room.enter({ id: 'laboratory-check', members: [{ id: 1, spawn_slot: 0 }] }, 1); lab.update();
  check(!lab.root.isEnabled() && lab.groundRadius(B.Vector3.FromArray(lab.site.up)) === null, 'В белой комнате веранда и её коллизии отключены');
  app.room.leave(); lab.update(player.position);
  check(lab.root.isEnabled(), 'После возвращения веранда снова видна');
  player.position = point(0, .06, -1.7); player.forward.copyFrom(back); player.pitch = -.15; player.update(0);
  scene.render();
  output.textContent += '\nВсе проверки лаборатории пройдены. Физический VR-шлем проверяется отдельно.';
} catch (error) { output.textContent += '\nFAIL · ' + (error?.message || String(error)); console.error(error); }
