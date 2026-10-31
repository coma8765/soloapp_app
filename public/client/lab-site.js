import { WATER_RADIUS, add, sub, mul, dot, cross, normalize } from '../shared/world.js';

// A dry, tree-free veranda near the starting point, with its entrance facing spawn.
export function laboratorySite(terrain, trees, guides = []) {
  const spawn = terrain.spawn(), up = normalize(spawn);
  const tangent = normalize(cross(up, [0, 0, 1])), side = cross(up, tangent);
  let best = null;
  for (let distance = 7; distance <= 18; distance += 2) for (let angle = 0; angle < 32; angle++) {
    const a = angle * Math.PI / 16;
    const u = normalize(add(mul(up, 38), mul(add(mul(tangent, Math.cos(a)), mul(side, Math.sin(a))), distance)));
    const forward = normalize(sub(spawn, mul(u, dot(spawn, u))));
    const right = normalize(cross(forward, u)), back = mul(forward, -1);
    const blocked = [...trees, ...guides].some(p => Math.abs(dot(p, right)) < 4.2 && dot(p, back) > -6.4 && dot(p, back) < 3.4 && dot(p, u) > 30);
    if (blocked) continue;
    const surface = (x, z) => {
      let y = 38, radius = 38;
      for (let i = 0; i < 4; i++) {
        radius = terrain.radius(normalize(add(add(mul(u, y), mul(right, x)), mul(back, z))));
        y = Math.sqrt(Math.max(1, radius * radius - x * x - z * z));
      }
      return { y, radius };
    };
    const heights = [];
    let dry = true;
    for (let x = -3.6; x <= 3.61; x += 1.2) for (let z = -2.8; z <= 2.81; z += 1.4) {
      const { radius, y } = surface(x, z);
      dry &&= radius > WATER_RADIUS + .2;
      heights.push(y);
    }
    const endHeight = Math.max(...[-1.15, 0, 1.15].map(x => surface(x, -5.8).y)) + .025;
    let base = Math.max(...heights, endHeight) + .12;
    // Keep the complete ramp above the curved terrain, including its side edges.
    for (let z = -5.55; z <= -2.79; z += .25) for (const x of [-1.15, 0, 1.15]) {
      const t = (-z - 2.8) / 3;
      base = Math.max(base, (surface(x, z).y + .04 - t * endHeight) / (1 - t));
    }
    const drop = base - endHeight;
    if (!dry || drop > 1.5) continue;
    const score = drop * 3 + (Math.max(...heights) - Math.min(...heights)) * 2 + distance * .12;
    if (!best || score < best.score) best = { up: u, forward, right, back, base, drop, score, position: mul(u, base) };
  }
  if (!best) throw Error('Не найден свободный сухой участок для лаборатории');
  return best;
}
