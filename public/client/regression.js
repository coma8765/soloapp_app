// Shared by the browser diagnostics and offline engine checks.
const B = window.BABYLON;
export function verifyInstancePlacements(data, check) {
  for (const [name, expected] of [['grassMatrices', 18000], ['leaves', 37840]]) {
    const values = data[name];
    const distinct = new Set();
    let minimum = Infinity;
    let maximum = 0;
    for (let i = 0; i < values.length; i += 16) {
      const position = values.slice(i + 12, i + 15);
      const radius = Math.hypot(...position);
      minimum = Math.min(minimum, radius);
      maximum = Math.max(maximum, radius);
      distinct.add(position.join(','));
    }
    check(values.length === expected * 16 && distinct.size === expected,
      `${name}: ${expected} различных размещений, без потерянных матриц`);
    check(minimum > 36 && maximum < 47,
      `${name}: растительность находится на поверхности планеты`);
  }
}

export function verifyCameraFrame(player, check) {
  const saved = {
    position: player.position.clone(), forward: player.forward.clone(), pitch: player.pitch,
    third: player.third, xr: player.xr, overview: player.overview,
  };
  player.third = false;
  player.xr = false;
  player.overview = false;
  try {
    for (const direction of [[0,1,0], [1,0,0], [-1,0,0], [0,-1,0], [0,0,1], [0,0,-1]]) {
      const up = B.Vector3.FromArray(direction);
      player.position = up.scale(player.terrain.radius(direction) + .06);
      player.forward = B.Vector3.Cross(up, new B.Vector3(.2,.5,.7)).normalize();
      player.pitch = -.3;
      let aligned = true;
      for (let frame = 0; frame < 360; frame++) {
        player.turn(Math.PI / 180);
        player.update(0);
        player.camera.getViewMatrix(true);
        const radial = player.position.normalizeToNew();
        const forward = player.forward.scale(Math.cos(player.pitch)).add(radial.scale(Math.sin(player.pitch)));
        const cameraUp = radial.scale(Math.cos(player.pitch)).subtract(player.forward.scale(Math.sin(player.pitch)));
        aligned &&= B.Vector3.Dot(player.camera.getForwardRay().direction, forward) > .99999;
        aligned &&= B.Vector3.Dot(player.camera.upVector, cameraUp) > .99999;
      }
      check(aligned, 'Плавный полный оборот камеры с местной вертикалью: ' + direction.join(','));
    }
  } finally {
    Object.assign(player, saved);
    player.update(0);
  }
}

export async function verifyLocalAvatar(player, check) {
  check(await player.avatar.ready, 'Локальная GLB-модель загружена без fallback');
  const avatar = player.avatar;
  check(avatar.skeleton.bones.length === 65, 'Humanoid-скелет: 65 костей');
  check(!avatar.fallback.isEnabled(), 'Капсула скрыта после загрузки модели');
  const meshes = avatar.container.meshes.filter(mesh => mesh.getTotalVertices() > 0);
  check(meshes.length === 3 && meshes.every(mesh => mesh.skeleton === avatar.skeleton && !mesh.isPickable),
    'Тело, глаза и брови привязаны к скелету и не перехватывают выбор объектов');
  for (const mesh of meshes) {
    await mesh.material.forceCompilationAsync(mesh);
    check(!mesh.material.getEffect()?.getCompilationError(), 'WebGL skin/material: ' + mesh.name);
    check(mesh.material.getActiveTextures().every(texture => texture.isReady()), 'Текстуры загружены: ' + mesh.name);
  }
  const saved = { position: player.position.clone(), forward: player.forward.clone(),
    pitch: player.pitch, third: player.third, xr: player.xr, overview: player.overview };
  try {
    player.overview = false;
    player.xr = false;
    player.third = true;
    player.pitch = 0;
    for (const direction of [[0,1,0], [1,0,0], [-1,0,0], [0,-1,0], [0,0,1], [0,0,-1]]) {
      const up = B.Vector3.FromArray(direction);
      player.position = up.scale(player.terrain.radius(direction) + .06);
      player.forward = B.Vector3.Cross(up, new B.Vector3(.2,.5,.7)).normalize();
      player.update(0);
      const world = player.body.computeWorldMatrix(true);
      const modelWorld = avatar.model.computeWorldMatrix(true);
      const facing = B.Vector3.TransformNormal(B.Axis.Z, modelWorld).normalize();
      check(B.Vector3.Distance(player.body.position, player.position) < 1e-6 &&
        B.Vector3.Dot(B.Vector3.TransformNormal(B.Axis.Y, world).normalize(), up) > .99999 &&
        B.Vector3.Dot(facing, player.forward) > .99999,
      'Аватар стоит на поверхности и смотрит вперёд: ' + direction.join(','));
    }
    check(player.body.isEnabled(), 'Аватар виден от третьего лица');
    const pose = avatar.joints.get('thigh_l').node.rotationQuaternion.clone();
    for (let frame = 0; frame < 10; frame++) avatar.update(1/60, 3, 0, true);
    check(Math.abs(B.Quaternion.Dot(pose, avatar.joints.get('thigh_l').node.rotationQuaternion)) < .999,
      'При движении меняется скелетная поза ног');
    for (let frame = 0; frame < 120; frame++) avatar.update(1/60, 0, 0, true);
    check(avatar.stride < .001, 'После остановки возвращается поза покоя');
    const head = avatar.joints.get('Head').node.rotationQuaternion.clone();
    avatar.update(0, 0, .6, true);
    check(Math.abs(B.Quaternion.Dot(head, avatar.joints.get('Head').node.rotationQuaternion)) < .99,
      'Голова следует за наклоном взгляда');
    player.third = false; player.update(0);
    check(!player.body.isEnabled(), 'В первом лице тело не перекрывает камеру');
    player.overview = true; player.update(0);
    check(player.body.isEnabled(), 'В обзоре планеты аватар виден');
    player.xr = true; player.update(0);
    check(!player.body.isEnabled(), 'В XR сохранён режим без тела перед камерой');
    player.xr = false; player.third = true; player.overview = false; player.update(0);
    check(player.body.isEnabled(), 'После XR восстанавливается аватар третьего лица');
  } finally {
    Object.assign(player, saved);
    player.update(0);
  }
}
