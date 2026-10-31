export const ROOM_MAP = 'white-room';
export const ROOM_HALF = 12;
export const ROOM_HEIGHT = 6;
export const ROOM_PLAYER_LIMIT = ROOM_HALF - .35;
export const roomSpawn = slot => [(slot % 4 - 1.5) * 3, 0, 4 + Math.floor(slot / 4) * 3];
export const validRoomPosition = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)
  && Math.abs(p[0]) <= ROOM_HALF && Math.abs(p[2]) <= ROOM_HALF && p[1] >= 0 && p[1] <= ROOM_HEIGHT;
