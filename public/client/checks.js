import { Terrain } from '../shared/world.js';
import { PlanetScene, FishView } from './scene.js';
import { Player } from './player.js';
import { verifyInstancePlacements, verifyCameraFrame } from './regression.js';
const B = window.BABYLON;
const output = document.getElementById('results');
const log = message => { output.textContent += '\n' + message; };
function check(condition, description) {
  if (!condition) throw Error(description);
  log('PASS · ' + description);
}
try {
  const data = await fetch('/assets/world.json').then(response => response.json());
  const terrain = new Terrain(data);
  const engine = new B.Engine(document.getElementById('canvas'), true);
  const scene = new B.Scene(engine);
  scene.useRightHandedSystem = true;
  const planet = new PlanetScene(scene, data);
  const player = new Player(scene, terrain, planet, document.getElementById('canvas'));
  const fish = new FishView(scene, data.fishProfiles);
  check(planet.terrain.getTotalVertices() === 33153, '33153 вершины исходного рельефа');
  check(planet.leaves.thinInstanceCount === 37840, '37840 листьев берёз');
  check(planet.grass.thinInstanceCount === 18000, '18000 пучков травы');
  check(fish.fish.length === 48, '48 моделей рыб с исходными размерами и цветами');
  verifyInstancePlacements(data, check);
  verifyCameraFrame(player, check);
  for (const mesh of [planet.terrain, planet.bark, planet.leaves, planet.grass, planet.water]) {
    log('Компиляция: ' + mesh.name);
    mesh.material.onError = (_effect, errors) => log('GLSL: ' + errors);
    await mesh.material.forceCompilationAsync(mesh, { useInstances: mesh.hasThinInstances });
    check(!mesh.material.getEffect()?.getCompilationError(), 'WebGL-шейдер: ' + mesh.name);
  }
  for (const direction of [[0,1,0], [1,0,0], [-1,0,0], [0,-1,0], [0,0,1], [0,0,-1]]) {
    const up = B.Vector3.FromArray(direction);
    player.position = up.scale(terrain.radius(direction) + .06);
    player.forward = B.Vector3.Cross(up, new B.Vector3(.2,.5,.7)).normalize();
    player.xr = true;
    for (let i = 0; i < 120; i++) player.update(1 / 60, player.forward);
    check(player.position.length() >= terrain.radius(player.position.asArray()) + .059, 'Коллизия на стороне ' + direction.join(','));
  }
  player.xr = false;
  player.spawn(1);
  player.third = true;
  player.update(0);
  player.toggleOverview();
  player.toggleOverview();
  check(player.third && scene.activeCamera === player.camera, 'Восстановление третьего лица после обзора');
  const wet = new B.Vector3(0,35,0);
  planet.updateActor('check', wet, .1);
  const count = planet.rippleCount;
  for (let i = 0; i < 10; i++) planet.updateActor('check', wet, .1);
  check(count > 0 && planet.rippleCount === count, 'Волны при входе и отсутствие волн в покое');
  planet.updateActor('check', new B.Vector3(.2,35,0), .1);
  check(planet.rippleCount === count + 1, 'Волны при движении');
  player.toggleOverview();
  engine.runRenderLoop(() => { player.update(.016); planet.update(.016, scene.activeCamera); scene.render(); });
  window.addEventListener('resize', () => engine.resize());
  log('\nВсе браузерные проверки пройдены. Визуально проверьте воду, берёзы и траву.');
} catch (error) {
  log('FAIL · ' + (error?.message || String(error)));
  console.error(error);
}
