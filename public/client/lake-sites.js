import { WATER_RADIUS, add, sub, mul, dot, normalize, length } from '../shared/world.js';

// Deterministic dry shore sites, clear of trunks. Keep the same placement in
// every local walk and use the existing lake navigation frames.
export function lakeProfessorSites(terrain, lakes, trees = []) {
  const spawn = terrain.spawn();
  return lakes.map((lake, id) => {
    let best = null;
    for (let angle = 0; angle < 64; angle++) {
      const a = angle * Math.PI / 32;
      const tangent = add(mul(lake.tangent, Math.cos(a)), mul(lake.side, Math.sin(a)));
      for (let distance = 1; distance <= 24; distance += .4) {
        const up = normalize(add(mul(lake.up, Math.cos(distance / WATER_RADIUS)), mul(tangent, Math.sin(distance / WATER_RADIUS))));
        const radius = terrain.radius(up);
        if (radius < WATER_RADIUS + .22) continue;
        const position = mul(up, radius + .02);
        if (trees.some(tree => length(sub(tree, position)) < 1.5)) continue;
        const score = length(sub(position, spawn)) + distance * .2;
        if (!best || score < best.score) best = { id, position, up, forward: normalize(sub(up, mul(lake.up, dot(up, lake.up)))), score };
        break;
      }
    }
    if (!best) throw Error('Не найден сухой берег для профессора у озера ' + (id + 1));
    return best;
  });
}
