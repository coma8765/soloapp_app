const $ = id => document.getElementById(id);
const SESSION_KEY = 'microplanet.auth.v1';

function validSession(data) {
  return data && typeof data.token === 'string' && /^[a-f0-9]{64}$/.test(data.token)
    && Number.isFinite(data.expires_at) && data.expires_at * 1000 > Date.now()
    && typeof data.user?.email === 'string' && data.user.email.length > 0;
}

export class Auth {
  constructor() {
    this.token = null;
    this.registration = true;
    $('auth-dialog').addEventListener('cancel', event => event.preventDefault());
    $('auth-switch').onclick = () => {
      this.registration = !this.registration;
      $('auth-title').textContent = this.registration ? 'Присоединиться к миру' : 'С возвращением';
      $('auth-submit').textContent = this.registration ? 'Зарегистрироваться и войти' : 'Войти';
      $('auth-switch').textContent = this.registration ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться';
      $('auth-password').autocomplete = this.registration ? 'new-password' : 'current-password';
      $('auth-error').textContent = '';
    };
    $('auth-form').onsubmit = event => { event.preventDefault(); this.submit(); };
    this.restore();
  }

  restore() {
    try {
      const data = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (validSession(data)) this.accept(data);
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      // Storage may be disabled or contain malformed data; local walking still works.
      try { localStorage.removeItem(SESSION_KEY); } catch { /* Storage unavailable. */ }
    }
  }

  accept(data) {
    this.token = data.token;
    this.expiresAt = data.expires_at * 1000;
    $('auth-password').value = '';
    $('logout').hidden = false;
    $('login').hidden = true;
    $('logout').title = `Выйти: ${data.user.email}`;
    $('auth-dialog').close();
    document.body.classList.remove('auth-required');
    const resolve = this.resolve;
    this.resolve = this.pending = null;
    resolve?.();
  }

  require(message = '') {
    document.body.classList.add('auth-required');
    $('auth-error').textContent = message;
    if (!$('auth-dialog').open) $('auth-dialog').show();
    if (this.pending) return this.pending;
    this.pending = new Promise(resolve => { this.resolve = resolve; });
    return this.pending;
  }

  async submit() {
    if (this.busy) return;
    for (const name of ['email', 'password']) {
      const input = $(`auth-${name}`);
      if (!input.checkValidity() || (name === 'password' && input.value.length < 8)) {
        $('auth-error').textContent = name === 'email' ? 'Введите корректный адрес почты.' : 'Пароль должен содержать не менее 8 символов.';
        input.focus({ preventScroll: true }); return;
      }
    }
    this.busy = true;
    $('auth-submit').disabled = $('auth-switch').disabled = true;
    $('auth-error').textContent = '';
    try {
      const response = await fetch(`/api/auth/${this.registration ? 'register' : 'login'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: $('auth-email').value.trim(), password: $('auth-password').value }),
        signal: AbortSignal.timeout(15000), cache: 'no-store', credentials: 'omit',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(data.error || 'Сервис входа недоступен. Перезапустите обновлённый C++ сервер.');
      if (!validSession(data))
        throw Error('Некорректный ответ сервиса входа.');
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({ token: data.token, expires_at: data.expires_at, user: { email: data.user.email } }));
      } catch {
        $('display-status').textContent = 'Вход выполнен, но браузер не разрешил сохранить сессию. После обновления потребуется войти снова.';
      }
      this.accept(data);
    } catch (error) {
      $('auth-error').textContent = error.name === 'TypeError' || error.name === 'TimeoutError'
        ? 'Сервер не отвечает. Проверьте соединение и повторите вход.' : error.message;
    } finally {
      this.busy = false;
      $('auth-submit').disabled = $('auth-switch').disabled = false;
    }
  }

  clear() {
    try {
      const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      // Another tab may have signed in with a different session meanwhile.
      if (!saved || saved.token === this.token) localStorage.removeItem(SESSION_KEY);
    } catch {
      try { localStorage.removeItem(SESSION_KEY); } catch { /* Storage unavailable. */ }
    }
    this.token = null;
    this.expiresAt = 0;
    $('logout').hidden = true;
    $('login').hidden = false;
    document.body.classList.add('auth-required');
  }

  async logout() {
    const token = this.token;
    this.clear();
    if (!token) return '';
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000), cache: 'no-store', credentials: 'omit',
      });
      if (!response.ok && response.status !== 401) throw Error('Logout failed');
      return '';
    } catch {
      return 'Вы вышли на этом устройстве. Сервер не подтвердил завершение сессии.';
    }
  }
}
