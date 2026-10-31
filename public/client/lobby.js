export class Lobby {
  constructor(auth, network, prepareWorld, onAuthRequired, world = {}) {
    Object.assign(this, { auth, network, prepareWorld, onAuthRequired, world });
    this.generation = 0;
    this.reset();
  }

  reset() {
    clearInterval(this.timer);
    this.generation++;
    this.token = null;
    this.servers = [];
    this.current = null;
    this.userId = null;
    this.visible = false;
    this.busy = false;
    this.error = '';
    this.pollError = false;
    this.connectedServer = this.loadAttempt = 0;
    this.polling = null;
    this.lastResponseTime = 0;
    this.clockOffset = Date.now() - performance.now();
    this.bestRtt = Infinity;
    this.network.disconnect();
    this.world.leave?.();
  }

  activate() {
    this.reset();
    if (!this.auth.token) return;
    this.token = this.auth.token;
    this.visible = true;
    void this.poll();
    this.timer = setInterval(() => { void this.poll(); }, 250);
  }

  async request(path = '', method = 'GET') {
    const generation = this.generation, token = this.token, sent = performance.now();
    const response = await fetch('/api/servers' + path, {
      method, headers: { Authorization: `Bearer ${token}` },
      credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    if (generation !== this.generation || token !== this.auth.token) throw Error('Stale lobby request');
    const data = await response.json().catch(() => ({}));
    if (generation !== this.generation || token !== this.auth.token) throw Error('Stale lobby request');
    if (response.status === 401) {
      this.reset(); this.auth.clear(); this.onAuthRequired();
      throw Error('Сессия завершена. Войдите снова.');
    }
    if (!response.ok) throw Error(data.error || 'Список серверов недоступен.');
    const received = performance.now(), rtt = received - sent;
    if (Number.isFinite(data.server_time_ms) && rtt < this.bestRtt) {
      this.bestRtt = rtt;
      this.clockOffset = data.server_time_ms - (sent + received) / 2;
    }
    return data;
  }

  accept(data) {
    if (data.server_time_ms < this.lastResponseTime) return false;
    this.lastResponseTime = data.server_time_ms;
    return true;
  }

  get countdown() { return this.current?.state === 'countdown'; }
  get secondsLeft() { return Math.max(0, Math.min(3, Math.ceil((this.current.starts_at_ms - performance.now() - this.clockOffset) / 1000))); }

  poll() {
    if (!this.token || this.busy) return Promise.resolve();
    if (this.polling) return this.polling;
    const generation = this.generation;
    this.polling = (async () => {
      try {
        const data = await this.request();
        if (generation !== this.generation || !this.accept(data)) return;
        if (this.pollError) { this.error = ''; this.pollError = false; }
        this.servers = data.servers; this.userId = data.user_id;
        this.apply(data.current);
      } catch (error) {
        if (generation === this.generation) {
          this.pollError = true;
          this.error = error.name === 'TimeoutError' || error.name === 'TypeError' ? 'Нет связи со списком серверов. Повторяем подключение…' : error.message;
        }
      } finally { if (generation === this.generation) this.polling = null; }
    })();
    return this.polling;
  }

  apply(server) {
    const previous = this.current;
    this.current = server;
    if (previous?.id !== server?.id || previous?.state !== server?.state) this.visible = true;
    if (!server || server.state !== 'running') {
      if (this.network.serverId) this.network.disconnect();
      this.connectedServer = 0;
      this.world.leave?.();
    }
    if (!server) {
      if (previous) this.error = 'Сервер закрыт. Выберите другой или создайте свой.';
      this.loadAttempt = 0;
    } else if (server.state === 'waiting') {
      this.loadAttempt = 0;
    } else if (server.state === 'loading') {
      const me = server.members.find(member => member.id === this.userId);
      if (me && !me.ready && this.loadAttempt !== server.id) void this.prepare(server.id);
    } else if (server.state === 'running' && this.connectedServer !== server.id) {
      this.world.enter?.(server, this.userId);
      this.connectedServer = server.id;
      this.network.connect(server.id);
      this.visible = false;
    }
  }

  async prepare(id) {
    const generation = this.generation;
    this.loadAttempt = id;
    this.error = '';
    try {
      await this.prepareWorld();
      if (generation !== this.generation || this.current?.id !== id || this.current.state !== 'loading') return;
      const data = await this.request(`/${id}/ready`, 'POST');
      if (generation === this.generation && this.accept(data)) this.apply(data.server);
    } catch (error) { if (generation === this.generation) this.error = 'Не удалось подготовить мир: ' + error.message; }
  }

  async action(action, method = 'POST') {
    if (!this.token || this.busy) return;
    const generation = this.generation;
    this.busy = true; this.error = '';
    try {
      if (this.polling) await this.polling;
      if (generation !== this.generation) return;
      const data = await this.request(action, method);
      if (generation !== this.generation || !this.accept(data)) return;
      // An explicit departure is not an unexpected owner closure.
      if (!data.server) this.current = null;
      this.apply(data.server);
    } catch (error) { if (generation === this.generation) this.error = error.message; }
    finally { if (generation === this.generation) { this.busy = false; void this.poll(); } }
  }

  show() { this.visible = true; void this.poll(); }
  reconnect() {
    if (this.current?.state === 'running') this.network.connect(this.current.id);
    else this.show();
  }
}
