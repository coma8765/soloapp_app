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
