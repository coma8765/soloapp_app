import { Terrain } from '../shared/world.js';
import { MarineLife } from './marine.js';
import { LakeProfessors } from './lake-professors.js';
import { Laboratory } from './laboratory.js';
const B = window.BABYLON, output = document.getElementById('results');
function check(ok, message) { if (!ok) throw Error(message); output.textContent += '\nPASS · ' + message; }
try {
  const data = await fetch('/assets/world.json').then(r => r.json()), terrain = new Terrain(data);
  const canvas = document.getElementById('canvas'), engine = new B.Engine(canvas, true), scene = new B.Scene(engine);
  scene.useRightHandedSystem = true;
  const far = B.Vector3.FromArray(terrain.spawn()).normalize().scale(120);
  const camera = new B.FreeCamera('Proximity test camera', far.clone(), scene); scene.activeCamera = camera;
  const planet = { visible: true, trees: data.trees.map(p => B.Vector3.FromArray(p)) };
  const player = { position: far.clone(), overview: false }, professors = new LakeProfessors(scene, terrain, planet);
  const lab = new Laboratory(scene, terrain, planet, professors);
  const marine = new MarineLife(scene, terrain, planet, player, canvas, { visible: false }, { active: false }, { active: false });
  check((await Promise.all([professors.ready, lab.ready, marine.ready])).every(Boolean), 'Координаты объектов загружаются отдельно от моделей');
  check(marine.card.texture.isReady(), 'Скрытая карточка не блокирует готовность сцены перед входом в мир');
  function move(position) {
    player.position.copyFrom(position); camera.position.copyFrom(position); camera.computeWorldMatrix(true);
    professors.update(0, player, camera, planet.visible); marine.update(0); lab.update(position);
  }
  move(far);
  check(!lab.built && !lab.root.getChildMeshes().length, 'Вдалеке геометрия веранды ещё не создана');
  check(!professors.loading && !professors.guides.length, 'Вдалеке GLB профессора не запрашивается');
  check(!marine.models.size && !marine.entities.length, 'Вдалеке GLB морских жителей не запрашиваются');
  const up = B.Vector3.FromArray(lab.site.up);
  lab.update(lab.root.position.add(up.scale(9)));
  check(lab.built && lab.root.isEnabled() && lab.vessels.length === 2, 'При приближении создаются веранда и две пробирки');
  const meshCount = lab.root.getChildMeshes().length;
  lab.update(lab.root.position.add(up.scale(12)));
  check(lab.root.isEnabled(), 'Гистерезис сохраняет веранду на границе расстояния');
  lab.update(lab.root.position.add(up.scale(17)));
  check(!lab.root.isEnabled(), 'При удалении веранда скрывается');
  lab.update(lab.root.position.add(up.scale(12)));
  check(!lab.root.isEnabled(), 'Веранда не мигает между порогами появления и скрытия');
  lab.update(lab.root.position.add(up.scale(9)));
  check(lab.root.isEnabled() && lab.root.getChildMeshes().length === meshCount, 'Возвращение использует прежние объекты веранды');
  const site = professors.sites[0];
  move(B.Vector3.FromArray(site.position));
  check(!!site.loading, 'Приближение запускает загрузку профессора');
  move(far); await Promise.all(professors.sites.map(s => s.loading)); move(far);
  check(professors.guides.length > 0 && professors.guides.every(g => !g.root.isEnabled() && !g.sign.isEnabled()), 'Поздно загруженный профессор не появляется после ухода');
  move(B.Vector3.FromArray(site.position));
  check(professors.guides.some(g => g.id === site.id && g.root.isEnabled()), 'Возвращение показывает загруженного профессора');
  const lake = marine.lakes[0], center = lake.up.scale(36.8);
  move(center);
  check(!!lake.loading, 'Приближение запускает загрузку животных озера');
  move(far); await Promise.all(marine.lakes.map(l => l.loading)); move(far);
  check(marine.entities.length > 0 && marine.entities.every(e => !e.root.isEnabled() && e.entries.animationGroups.every(g => !g.isPlaying)), 'Поздно загруженные животные скрыты и не анимируются вдалеке');
  const count = marine.entities.length;
  move(center);
  check(marine.entities.some(e => e.lake === lake && e.active), 'При возвращении жители озера появляются');
  check(marine.entities.length === count && marine.models.size === 2, 'Общие модели двух видов берутся из кэша');
  planet.visible = false; move(center);
  check(!lab.root.isEnabled() && professors.guides.every(g => !g.root.isEnabled()) && marine.entities.every(e => !e.root.isEnabled()), 'В другом мире все локальные модели скрыты');
  for (const file of ['clownfish.glb', 'lobster.glb', 'professor-einstein.glb']) {
    const requests = performance.getEntriesByType('resource').filter(entry => new URL(entry.name).pathname.endsWith('/' + file));
    check(requests.length === 1, file + ': ровно одна загрузка при нескольких подходах');
  }
  output.textContent += '\nВсе проверки загрузки по расстоянию пройдены.';
} catch (error) { output.textContent += '\nFAIL · ' + (error?.message || String(error)); console.error(error); }
