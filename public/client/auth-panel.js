const B = window.BABYLON;
const $ = id => document.getElementById(id);
const WIDTH = 1024, HEIGHT = 1120;

// A single world-space surface for mouse, physical keyboard and XR target rays.
// Native inputs remain the accessible source of truth and support paste/autofill.
export class AuthPanel {
  constructor(scene, auth, player, canvas, walk) {
    Object.assign(this, { scene, auth, player, canvas, walk });
    this.field = 'email';
    this.shift = false;
    this.symbols = false;
    this.hover = '';
    this.targets = [];
    this.rays = new Map();
    this.mesh = B.MeshBuilder.CreatePlane('account-panel', { width: 1.25, height: 1.25 * HEIGHT / WIDTH }, scene);
    this.mesh.rotationQuaternion = B.Quaternion.Identity();
    this.mesh.renderingGroupId = 3;
    this.texture = new B.DynamicTexture('account-panel-texture', { width: WIDTH * 2, height: HEIGHT * 2 }, scene, true);
    this.texture.hasAlpha = true;
    this.texture.anisotropicFilteringLevel = 8;
    const material = new B.StandardMaterial('account-panel-material', scene);
    material.diffuseTexture = this.texture;
    material.emissiveColor = B.Color3.White();
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.useAlphaFromDiffuseTexture = true;
    this.mesh.material = material;
    this.mesh.setEnabled(false);
    document.body.classList.add('spatial-ui');
    for (const name of ['email', 'password']) {
      $(`auth-${name}`).addEventListener('focus', () => { this.field = name; });
    }
    canvas.addEventListener('pointermove', event => {
      if (this.xr) return;
      this.hover = this.targetAt(this.pickMouse(event))?.id || '';
      canvas.style.cursor = this.hover ? 'pointer' : '';
    });
    canvas.addEventListener('click', event => {
      const hit = this.pickMouse(event);
      if (!hit) return;
      event.stopImmediatePropagation();
      this.activate(this.targetAt(hit));
    }, true);
    window.addEventListener('resize', () => { if (this.visible && !this.xr) this.present(); });
  }

  get visible() { return this.mesh.isEnabled(); }

  present() {
    const camera = this.scene.activeCamera;
    camera.computeWorldMatrix(true);
    const world = camera.getWorldMatrix();
    let distance = 1.8;
    if (!this.xr) {
      const aspect = this.scene.getEngine().getAspectRatio(camera);
      distance = Math.max(1.2, .83 / Math.tan(camera.fov / 2), .76 / (Math.tan(camera.fov / 2) * aspect));
    }
    this.mesh.position.copyFrom(B.Vector3.TransformCoordinates(new B.Vector3(0, 0, -distance), world));
    world.decompose(undefined, this.mesh.rotationQuaternion);
    this.mesh.computeWorldMatrix(true);
  }

  sync() {
    const visible = $('auth-dialog').open && !this.auth.token;
    if (visible !== this.visible) {
      this.mesh.setEnabled(visible);
      if (visible) this.present();
      else { this.hover = ''; this.lastState = ''; this.canvas.style.cursor = ''; this.hideRays(); }
    }
    if (!visible) return;
    if (this.recenter) { this.present(); this.recenter = false; }
    const state = JSON.stringify([this.field, this.shift, this.symbols, this.hover, this.auth.busy,
      this.auth.registration, $('auth-email').value, $('auth-password').value, $('auth-error').textContent]);
    if (state !== this.lastState) { this.lastState = state; this.draw(); }
  }

  draw() {
    const c = this.texture.getContext();
    c.setTransform(2, 0, 0, 2, 0, 0);
    c.clearRect(0, 0, WIDTH, HEIGHT);
    this.targets = [];
    const box = (x, y, w, h, fill, stroke = '#537e8d') => {
      c.beginPath(); c.roundRect(x, y, w, h, 18); c.fillStyle = fill; c.fill();
      c.strokeStyle = stroke; c.lineWidth = 2; c.stroke();
    };
    const text = (value, x, y, size = 28, color = '#eaf6f6') => {
      c.font = `${size}px sans-serif`; c.fillStyle = color; c.textAlign = 'left'; c.fillText(value, x, y);
    };
    const button = (id, label, x, y, w, h, action, accent = false) => {
      this.targets.push({ id, x, y, w, h, action });
      box(x, y, w, h, this.hover === id ? '#447481' : accent ? '#bde5d1' : '#1c3d4d', this.hover === id ? '#dcfff2' : '#507784');
      c.font = '28px sans-serif'; c.textAlign = 'center'; c.fillStyle = accent ? '#13333b' : '#eaf6f6';
      c.fillText(label, x + w / 2, y + h / 2 + 10);
    };
    box(3, 3, WIDTH - 6, HEIGHT - 6, '#102c3bee', '#8fbbc6');
    text('MICRO / PLANET', 48, 59, 24, '#c0e6dc');
    text('ЛОКАЛЬНАЯ ПРОГУЛКА', 642, 59, 21, '#a8c4cf');
    text(this.auth.registration ? 'Присоединиться к миру' : 'С возвращением', 48, 118, 44);
    text('Планета уже здесь. Войдите, чтобы встретить других.', 48, 165, 27, '#adc8d2');
    for (const [name, label, y] of [['email', 'Почта', 226], ['password', 'Пароль · от 8 символов', 334]]) {
      text(label, 48, y - 14, 25, '#adc8d2');
      const input = $(`auth-${name}`);
      const active = this.field === name;
      box(48, y, 928, 70, active ? '#244758' : '#183544', active ? '#a4ead9' : '#4a6e7b');
      let value = name === 'password' ? '•'.repeat(Array.from(input.value).length) : input.value;
      if (value.length > 44) value = '…' + value.slice(-43);
      text(value || (name === 'email' ? 'you@example.com' : 'Ваш пароль'), 70, y + 46, 32, value ? '#f0fbf9' : '#8ba9b6');
      this.targets.push({ id: name, x: 48, y, w: 928, h: 70, action: () => {
        this.field = name;
        if (!this.xr) input.focus({ preventScroll: true });
      } });
    }
    const error = $('auth-error').textContent;
    text(error.slice(0, 70), 48, 435, 23, '#ffd1b8');
    text(error.slice(70, 140), 48, 462, 23, '#ffd1b8');
    button('submit', this.auth.busy ? 'Подключаемся…' : this.auth.registration ? 'Создать аккаунт и войти' : 'Войти',
      48, 480, 928, 62, () => { void this.auth.submit(); }, true);
    button('switch', this.auth.registration ? 'Уже есть аккаунт? Войти' : 'Создать новый аккаунт',
      48, 554, 928, 48, () => $('auth-switch').click());
    const rows = this.symbols ? ['!@#$%^&*()', '[]{}<>/\\|~', '`_+-=;:\'"', ',.?€£¥₽№'] : ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm@.'];
    rows.forEach((row, index) => {
      const chars = Array.from(this.shift && !this.symbols ? row.toUpperCase() : row);
      const w = 82, gap = 10, x = (WIDTH - chars.length * (w + gap) + gap) / 2;
      chars.forEach((key, i) => button('key-' + index + '-' + i, key, x + i * (w + gap), 624 + index * 68, w, 58, () => this.write(key)));
    });
    button('shift', this.shift ? 'ABC ↑' : 'abc ↑', 48, 902, 170, 60, () => { this.shift = !this.shift; });
    button('symbols', this.symbols ? 'abc' : '#+=', 230, 902, 152, 60, () => { this.symbols = !this.symbols; });
    button('space', 'Пробел', 394, 902, 210, 60, () => this.write(' '));
    button('backspace', '⌫', 616, 902, 170, 60, () => this.write(null));
    button('next', 'Далее', 798, 902, 178, 60, () => { this.field = this.field === 'email' ? 'password' : 'email'; });
    button('walk', 'Продолжить прогулку  ↗', 48, 992, 928, 66, () => {
      $('auth-dialog').close(); document.activeElement?.blur(); this.sync(); this.walk();
    });
    text(this.xr ? 'Луч + триггер · B — открыть / убрать панель' : 'Мышь / клавиатура · Esc — вернуться после прогулки', 48, 1094, 24, '#adc8d2');
    this.texture.update();
  }

  write(key) {
    if (this.auth.busy) return;
    const input = $(`auth-${this.field}`);
    const value = Array.from(input.value);
    if (key === null) value.pop(); else value.push(key);
    input.value = value.join('').slice(0, input.maxLength);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (!this.xr) input.focus({ preventScroll: true });
  }

  activate(target) {
    if (!target || this.auth.busy) return;
    target.action(); this.sync();
  }

  targetAt(pick) {
    const uv = pick?.getTextureCoordinates();
    if (!uv) return null;
    const x = uv.x * WIDTH, y = (1 - uv.y) * HEIGHT;
    return this.targets.find(t => x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h);
  }

  pickMouse(event) {
    if (!this.visible || this.xr) return null;
    const rect = this.canvas.getBoundingClientRect();
    const hit = this.scene.pick(event.clientX - rect.left, event.clientY - rect.top, mesh => mesh === this.mesh);
    return hit?.hit ? hit : null;
  }

  xrRay(frame, source, referenceSpace, origin) {
    const pose = frame.getPose(source.targetRaySpace, referenceSpace);
    if (!pose) return null;
    const { position: p, orientation: q } = pose.transform;
    const rotation = new B.Quaternion(q.x, q.y, q.z, q.w);
    const direction = new B.Vector3(0, 0, -1).rotateByQuaternionToRef(rotation, B.Vector3.Zero());
    const world = origin.computeWorldMatrix(true);
    return new B.Ray(B.Vector3.TransformCoordinates(new B.Vector3(p.x, p.y, p.z), world), B.Vector3.TransformNormal(direction, world).normalize(), 5);
  }

  updateXR(frame, referenceSpace, origin) {
    if (!this.visible || !this.xr) { this.hideRays(); return; }
    this.hover = '';
    for (const visual of this.rays.values()) visual.setEnabled(false);
    for (const source of frame.session.inputSources) {
      const ray = this.xrRay(frame, source, referenceSpace, origin);
      if (!ray) continue;
      const pick = this.scene.pickWithRay(ray, mesh => mesh === this.mesh);
      const target = this.targetAt(pick);
      if (target) this.hover = target.id;
      const points = [ray.origin, pick?.hit ? pick.pickedPoint : ray.origin.add(ray.direction.scale(2))];
      let line = this.rays.get(source);
      if (!line) {
        line = B.MeshBuilder.CreateLines('account-controller-ray', { points, updatable: true }, this.scene);
        line.isPickable = false; line.renderingGroupId = 3; this.rays.set(source, line);
      } else B.MeshBuilder.CreateLines('account-controller-ray', { points, instance: line }, this.scene);
      line.color = target ? new B.Color3(.7, 1, .83) : new B.Color3(.4, .65, .75);
      line.setEnabled(true);
    }
    for (const [source, line] of this.rays) if (![...frame.session.inputSources].includes(source)) { line.dispose(); this.rays.delete(source); }
  }

  selectXR(event, referenceSpace, origin) {
    if (!this.visible) return;
    const ray = this.xrRay(event.frame, event.inputSource, referenceSpace, origin);
    if (ray) this.activate(this.targetAt(this.scene.pickWithRay(ray, mesh => mesh === this.mesh)));
  }

  hideRays() { for (const line of this.rays.values()) line.setEnabled(false); }
}
