export const AVATARS = Object.freeze([
  { id: 'male', name: 'Атлет', description: 'Мужской аватар', url: '/assets/avatar/player.glb',
    height: 1.81958638317883, floor: -.009509669616818428 },
  { id: 'female', name: 'Атлетка', description: 'Женский аватар', url: '/assets/avatar/player-female.glb',
    height: 1.7750510573387146, floor: -.008407175540924072 },
  { id: 'uraraka', name: 'Очако Урарака', description: 'Статическая поза · Padalab · CC BY-NC-SA', url: '/assets/avatar/uraraka-ochako.glb',
    height: 1.8824622025713325, floor: -.0009810319170355797, rigged: false },
]);
export const DEFAULT_AVATAR = AVATARS[0].id;
export const AVATAR_STORAGE_KEY = 'microplanet.avatar.v1';
export const findAvatar = id => AVATARS.find(avatar => avatar.id === id);

// A device preference, independent of the login token and safe in private mode.
export class AvatarPreferences {
  constructor(storage = () => window.localStorage) {
    this.storage = storage;
    this.id = DEFAULT_AVATAR;
    this.saved = false;
    try {
      const id = this.storage().getItem(AVATAR_STORAGE_KEY);
      if (findAvatar(id)) { this.id = id; this.saved = true; }
    } catch { /* Storage may be denied; a session-only choice still works. */ }
  }

  save(id) {
    if (!findAvatar(id)) throw Error('Unknown avatar');
    this.id = id;
    try {
      this.storage().setItem(AVATAR_STORAGE_KEY, id);
      this.saved = true;
      return true;
    } catch {
      this.saved = false;
      return false;
    }
  }
}
