import { Terrain, WATER_RADIUS } from '../shared/world.js';
import { PlanetScene, vec, orientation } from './scene.js';
import { LakeProfessors } from './lake-professors.js';
const B = window.BABYLON, output = document.getElementById('results');
const check = (ok, message) => { if (!ok) throw Error(message); output.textContent += '\nPASS · ' + message; };
try {
  const engine = new B.Engine(document.getElementById('canvas'), true), scene = new B.Scene(engine); scene.useRightHandedSystem = true;
  const data = await fetch('/assets/world.json').then(r => r.json());
  const terrain = new Terrain(data), planet = new PlanetScene(scene, data), professors = new LakeProfessors(scene, terrain, planet);
  const camera = new B.FreeCamera('professor-test-camera', vec(terrain.spawn()), scene); camera.minZ = .05;
  scene.activeCamera = camera;
  check(await professors.ready && professors.sites.length === 4, 'У каждого из четырёх озёр есть место профессора');
  for (const site of professors.sites) {
    professors.update(0, { position: vec(site.position) }, camera);
    await site.loading;
  }
  check(professors.guides.length === 4, 'Профессора загружены после посещения всех берегов');
  for (const guide of professors.guides) {
    check(guide.root.position.length() > WATER_RADIUS && Math.abs(guide.root.position.length() - terrain.radius(guide.up) - .02) < .001,
      `Озеро ${guide.id + 1}: профессор на сухом берегу и на поверхности`);
    check(planet.trees.every(tree => B.Vector3.Distance(tree, guide.root.position) >= 1.5), 'Профессор не пересекает стволы деревьев');
    const up = B.Vector3.TransformNormal(B.Axis.Y, guide.root.computeWorldMatrix(true)).normalize();
    check(B.Vector3.Dot(up, vec(guide.up)) > .999, 'Локальная вертикаль совпадает с вертикалью планеты');
  }
  const guide = professors.guides[0], up = vec(guide.up), forward = vec(guide.forward), side = B.Vector3.Cross(forward, up).normalize();
  const near = guide.root.position.add(side.scale(3));
  camera.position.copyFrom(guide.root.position.add(forward.scale(5)).add(up.scale(2.3)));
  const target = guide.root.position.add(up.scale(1.4)), direction = target.subtract(camera.position).normalize();
  const cameraRight = B.Vector3.Cross(direction, up).normalize(), cameraUp = B.Vector3.Cross(cameraRight, direction).normalize();
  camera.rotationQuaternion = orientation(direction, cameraUp); camera.updateUpVectorFromRotation = true;
  const player = { position: near };
  professors.update(1, player, camera);
  check(guide.near && professors.nearest === 0 && guide.state.includes('Здравствуйте'), 'При приближении появляется приветствие только у ближайшего профессора');
  const look = B.Vector3.TransformNormal(new B.Vector3(0,0,-1), guide.root.computeWorldMatrix(true)).normalize();
  check(B.Vector3.Dot(look, side) > .99, 'Профессор поворачивается к подошедшему участнику');
  player.position = guide.root.position.add(side.scale(9)); professors.update(1, player, camera);
  check(!guide.near && professors.nearest === null, 'При удалении профессор возвращается в ожидание');
  professors.update(.1, player, camera, false);
  check(professors.guides.every(g => !g.root.isEnabled() && !g.sign.isEnabled()), 'В белой комнате профессора скрыты');
  player.position = near; professors.update(.1, player, camera, true);
  for (const mesh of guide.model.getChildMeshes().filter(mesh => mesh.getTotalVertices() > 0)) {
    await mesh.material.forceCompilationAsync(mesh);
    check(mesh.material.getActiveTextures().every(t => t.isReady()), 'Материалы и текстуры GLB готовы');
  }
  player.position = guide.root.position.add(forward.scale(4));
  engine.runRenderLoop(() => { professors.update(.016, player, camera); planet.update(.016, camera); scene.render(); });
  output.textContent += '\nВсе проверки профессоров пройдены.';
} catch (error) { output.textContent += '\nFAIL · ' + error.message; console.error(error); }
