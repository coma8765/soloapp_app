import { ROOM_MAP, validRoomPosition } from './room.js';
export const WATER_RADIUS = 36.8;
export const BASE_RADIUS = 36;
export const MAX_PLAYERS = 8;
export const add = (a, b) => a.map((v, i) => v + b[i]);
export const sub = (a, b) => a.map((v, i) => v - b[i]);
export const mul = (a, s) => a.map(v => v * s);
export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const length = a => Math.hypot(...a);
export const normalize = a => mul(a, 1 / Math.max(length(a), 1e-9));
export const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const mix = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x-a)/(b-a), 0, 1); return t*t*(3-2*t); };

export class Terrain {
  constructor(data) { this.data = data; }
  radius(direction) {
    const u = normalize(direction), {latitudes: h, longitudes: w, radii} = this.data;
    const x = ((Math.atan2(u[2], u[0]) / (2*Math.PI) + 1) % 1) * w;
    const y = Math.acos(clamp(u[1], -1, 1)) / Math.PI * h;
    const ix = Math.floor(x), iy = Math.min(h-1, Math.floor(y));
    const at = (dx, dy) => radii[(iy+dy)*(w+1)+ix+dx];
    return mix(mix(at(0,0),at(1,0),x-ix),mix(at(0,1),at(1,1),x-ix),y-iy);
  }
  spawn(slot = 0) {
    const u = normalize([(slot%4-1.5)*0.045, 1, 0.16+Math.floor(slot%8/4)*0.055]);
    return mul(u, this.radius(u)+0.12);
  }
  shoreDistance(position) {
    const up = normalize(position);
    if (this.radius(up) <= WATER_RADIUS) return Math.max(0,length(position)-WATER_RADIUS);
    let tangent = cross(up,[0,1,0]);
    if (length(tangent)<0.01) tangent = cross(up,[1,0,0]);
    tangent = normalize(tangent);
    const side = cross(up,tangent);
    for (const distance of [1,2,3,4.5,6,8,11,15,20,26]) {
      for (let i=0;i<32;i++) {
        const a=i*Math.PI/16, arc=distance/WATER_RADIUS;
        const u=add(mul(up,Math.cos(arc)),mul(add(mul(tangent,Math.cos(a)),mul(side,Math.sin(a))),Math.sin(arc)));
        if (this.radius(u)<=WATER_RADIUS) return length(sub(position,mul(u,WATER_RADIUS)));
      }
    }
    return 30;
  }
}

export function validState(s, map = 'planet') {
  return s && Number.isSafeInteger(s.sequence) && s.sequence >= 0 &&
    Array.isArray(s.position) && s.position.length === 3 && s.position.every(Number.isFinite) &&
    (map === ROOM_MAP ? s.map === ROOM_MAP && validRoomPosition(s.position) : (!s.map || s.map === 'planet') && length(s.position) >= 25 && length(s.position) <= 50) &&
    Array.isArray(s.rotation) && s.rotation.length === 4 && s.rotation.every(Number.isFinite) &&
    Math.abs(length(s.rotation)-1)<0.05 && Number.isFinite(s.pitch) && Math.abs(s.pitch)<=Math.PI/2;
}
