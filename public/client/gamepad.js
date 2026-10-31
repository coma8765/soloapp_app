import { clamp } from '../shared/world.js';

export function stick(x = 0, y = 0, deadzone = .18) {
  x = Number.isFinite(x) ? clamp(x, -1, 1) : 0;
  y = Number.isFinite(y) ? clamp(y, -1, 1) : 0;
  const length = Math.hypot(x, y);
  if (length <= deadzone) return { x: 0, y: 0 };
  const scale = Math.min(1, (length - deadzone) / (1 - deadzone)) / length;
  return { x: x * scale, y: y * scale };
}

export class GamepadControls {
  constructor(player, panel, xr, status) {
    Object.assign(this, { player, panel, xr, status });
    this.previous = [];
    this.needsNeutral = true;
    this.active = false;
    this.padKey = null;
    this.repeatAt = 0;
    this.direction = '';
    this.turnArmed = true;
    this.time = 0;
    window.addEventListener('blur', () => this.release());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.release(); });
    window.addEventListener('gamepaddisconnected', event => { if (event.gamepad.index === this.index) this.release(); });
    const mouseOrKeyboard = () => { this.active = false; panel.controllerActive = false; panel.controllerFocus = ''; };
    window.addEventListener('pointerdown', mouseOrKeyboard);
    window.addEventListener('pointermove', event => { if (event.movementX || event.movementY) mouseOrKeyboard(); });
    window.addEventListener('keydown', mouseOrKeyboard);
  }

  release() {
    this.player.gamepadMove = null;
    this.previous = [];
    this.needsNeutral = true;
    this.direction = '';
    this.turnArmed = true;
    this.active = false;
    this.panel.controllerFocus = '';
    this.panel.controllerActive = false;
  }

  focus(id) {
    const target = this.panel.targets.find(target => target.id === id);
    if (target) this.panel.controllerFocus = target.id;
    return target;
  }

  selection() {
    return this.panel.targets.find(target => target.id === this.panel.controllerFocus)
      || this.focus(['avatar-' + this.panel.draft, 'email', 'create-server', 'start-server', 'reconnect-server', 'walk']
        .find(id => this.panel.targets.some(target => target.id === id)))
      || this.focus(this.panel.targets[0]?.id);
  }

  navigate(x, y) {
    const current = this.selection();
    if (!current) return;
    let best = null, score = Infinity;
    for (const target of this.panel.targets) {
      const dx = target.x + target.w / 2 - current.x - current.w / 2;
      const dy = target.y + target.h / 2 - current.y - current.h / 2;
      const forward = dx * x + dy * y, side = Math.abs(dx * y - dy * x);
      const overlap = x ? (current.h + target.h) / 2 : (current.w + target.w) / 2;
      if (forward <= 1 || side > overlap + forward * .5) continue;
      const cost = forward + Math.max(0, side - overlap) * 5 + side * .1;
      if (cost < score) { best = target; score = cost; }
    }
    if (best) this.focus(best.id);
  }

  cycle(step) {
    const target = this.selection(), targets = this.panel.targets;
    if (!target || !targets.length) return;
    this.focus(targets[(targets.indexOf(target) + step + targets.length) % targets.length].id);
  }

  closePanel() {
    if (this.panel.lobby?.countdown) return;
    if (this.panel.settingsOpen) { this.panel.closeSettings(); return; }
    if (this.panel.auth.token) this.panel.lobby.visible = false;
    else document.getElementById('auth-dialog').close();
    document.activeElement?.blur();
    this.panel.controllerFocus = '';
    this.panel.sync();
  }

  update(dt) {
    this.time += dt;
    this.player.gamepadMove = null;
    let pads;
    try { pads = Array.from(navigator.getGamepads?.() || []).filter(pad => pad?.connected && pad.mapping === 'standard'); }
    catch { pads = []; }
    // xr-standard controllers are handled by XRView and never double-counted here.
    const pad = pads.find(pad => pad.index === this.index)
      || pads.find(pad => /dualsense|054c|wireless controller/i.test(pad.id)) || pads[0];
    if (!pad) {
      this.release(); this.padKey = null; this.index = null;
      this.status.hidden = true;
      return;
    }
    this.status.hidden = false;
    const key = `${pad.index}:${pad.id}`;
    if (this.padKey !== key) { this.release(); this.padKey = key; this.index = pad.index; }
    const down = pad.buttons.map(button => button.pressed || button.value > .5);
    const left = stick(pad.axes[0], pad.axes[1]), right = stick(pad.axes[2], pad.axes[3]);
    const visibleXR = this.xr.active && this.xr.helper?.sessionManager.session?.visibilityState === 'visible';
    if (document.hidden || (this.xr.active && !visibleXR) || (!document.hasFocus() && !visibleXR) || this.panel.lobby?.countdown || (!this.player.inputEnabled && !this.panel.settingsOpen)) {
      this.release(); this.status.textContent = 'DualSense · управление приостановлено'; return;
    }
    if (this.needsNeutral) {
      this.previous = down;
      if (!down.some(Boolean) && !left.x && !left.y && !right.x && !right.y) this.needsNeutral = false;
      this.status.textContent = this.needsNeutral ? 'DualSense · отпустите кнопки и стики' : 'DualSense подключён · □ / Options — меню';
      return;
    }
    const pressed = index => !!down[index] && !this.previous[index];
    if (down.some(Boolean) || left.x || left.y || right.x || right.y) this.active = true;
    if (pressed(9) || pressed(2)) {
      if (this.panel.visible) this.closePanel();
      else { document.exitPointerLock?.(); this.panel.toggle(); this.panel.sync(); }
    } else if (pressed(1)) {
      if (this.panel.visible) this.closePanel();
      else if (this.player.overview && !this.xr.active) this.player.toggleOverview();
    } else if (this.panel.visible) {
      if (this.active) this.selection();
      let x = Number(!!down[15]) - Number(!!down[14]), y = Number(!!down[13]) - Number(!!down[12]);
      if (!x && !y && Math.max(Math.abs(left.x), Math.abs(left.y)) > .55) {
        if (Math.abs(left.x) > Math.abs(left.y)) x = Math.sign(left.x); else y = Math.sign(left.y);
      }
      if (x && y) x = 0;
      const direction = x || y ? `${x},${y}` : '';
      if (direction && (direction !== this.direction || this.time >= this.repeatAt)) {
        this.navigate(x, y); this.repeatAt = this.time + (direction !== this.direction ? .38 : .13);
      }
      this.direction = direction;
      if (pressed(4)) this.cycle(-1);
      if (pressed(5)) this.cycle(1);
      if (pressed(0)) {
        const target = this.selection();
        // Gamepad polling does not grant browser Pointer Lock user activation.
        if (target?.id === 'walk') this.closePanel();
        else if (target?.id === 'reconnect-server') { this.panel.lobby.reconnect(); this.closePanel(); }
        else this.panel.activate(target);
      }
    } else {
      this.direction = '';
      if (pressed(3) && !this.xr.active && !this.player.overview) this.player.third = !this.player.third;
      if (pressed(11) && !this.xr.active) this.player.toggleOverview();
      if (!this.player.overview) {
        this.player.gamepadMove = { x: left.x, y: -left.y };
        if (this.xr.active) {
          if (Math.abs(right.x) < .3) this.turnArmed = true;
          if (Math.abs(right.x) > .7 && this.turnArmed) { this.turnArmed = false; this.xr.turn(-Math.sign(right.x) * Math.PI / 6); }
        } else {
          this.player.turn(-right.x * dt * 1.9);
          this.player.pitch = clamp(this.player.pitch - right.y * dt * 1.5, -85 * Math.PI / 180, 85 * Math.PI / 180);
        }
      }
    }
    this.previous = down;
    this.panel.controllerActive = this.active;
    this.status.textContent = this.panel.visible
      ? 'DualSense · крестовина / L — выбор · ✕ — подтвердить · ○ — назад'
      : 'DualSense · L — идти · R — смотреть · □ / Options — меню · △ — вид';
  }
}
