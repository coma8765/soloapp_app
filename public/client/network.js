import { validState } from '../shared/world.js';
import { ROOM_MAP, validRoomPosition } from '../shared/room.js';
import { vec } from './scene.js';
import { LocalAvatar } from './local-avatar.js';
import { DEFAULT_AVATAR, findAvatar } from './avatar-catalog.js';
const B = window.BABYLON;

export class Network {
  constructor(scene, player, fish, planet, auth, onAuthRequired, voice = null) {
    Object.assign(this, { scene, player, fish, planet, auth, onAuthRequired, voice });
    this.rtcConfig = { iceServers: [] };
    this.remotes = new Map();
    this.peers = new Map();
    this.id = 0;
    this.sequence = 0;
    this.rx = 0;
    this.status = 'Локальная прогулка';
    this.worldTransport = 'доступны после входа';
    this.ping = null;
    this.lastSend = 0;
    this.lastPing = 0;
    this.worldAttempt = 0;
    this.worldReceived = 0;
    this.worldTick = -1;
    this.generation = 0;
  }

  send(message) {
    if (this.id && this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  clearPeers() {
    this.voice?.disconnect();
    for (const peer of this.peers.values()) peer.pc.close();
    this.peers.clear();
    this.worldPC?.close();
    this.worldPC = null;
    this.worldChannel = null;
    for (const remote of this.remotes.values()) remote.node.dispose(false, true);
    this.remotes.clear();
    this.planet.actors.clear();
    this.fish.reset();
    this.worldReceived = 0;
    this.worldTick = -1;
  }

  disconnect() {
    this.generation++;
    this.socket?.close();
    this.socket = null;
    this.clearPeers();
    this.ping = null;
    this.id = 0;
    this.serverId = 0;
    this.status = 'Локальная прогулка';
    this.worldTransport = 'доступны после входа';
  }

  connect(serverId = this.serverId) {
    this.disconnect();
    if (!this.auth.token || Date.now() >= this.auth.expiresAt) { this.requireAuth(); return; }
    if (!Number.isSafeInteger(serverId) || serverId < 0) { this.onRoomRequired?.(); return; }
    this.serverId = serverId;
    const generation = this.generation;
    this.status = 'Подключение…';
    this.worldTransport = 'ожидание';
    const signal = new URL(location.href).searchParams.get('signal') ||
      `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/signal`;
    try {
      const url = new URL(signal);
      if (url.host !== location.host || url.protocol !== (location.protocol === 'https:' ? 'wss:' : 'ws:') || url.username || url.password)
        throw Error('Signaling must use the account server origin');
      this.socket = new WebSocket(url);
    }
    catch { this.status = 'Некорректный адрес сервера'; return; }
    this.socket.onopen = () => {
      if (generation === this.generation) this.socket.send(JSON.stringify({ type: 'auth', token: this.auth.token, server_id: serverId }));
    };
    this.socket.onmessage = event => {
      if (generation !== this.generation) return;
      try { this.message(JSON.parse(event.data)); }
      catch (error) { console.warn('Network message:', error); }
    };
    this.socket.onclose = event => {
      if (generation !== this.generation) return;
      if (event.code === 1008 && event.reason === 'Unauthorized') { this.requireAuth(); return; }
      if (event.code === 1008 && event.reason === 'Room unavailable') { this.roomRequired(); return; }
      this.status = event.reason === 'Room is full' ? 'Комната заполнена · 8 игроков' : 'Нет соединения · переподключитесь';
      this.worldTransport = 'отключён';
      this.id = 0;
      this.clearPeers();
    };
    this.socket.onerror = () => { if (generation === this.generation) this.status = 'Сервер недоступен'; };
  }

  requireAuth() {
    this.disconnect();
    this.auth.clear();
    this.onAuthRequired();
  }

  roomRequired() {
    this.disconnect();
    this.onRoomRequired?.();
  }

  message(message) {
    const { type } = message;
    if (type === 'auth_error') { this.requireAuth(); return; }
    if (type === 'room_error') { this.roomRequired(); return; }
    if (type === 'welcome') {
      if (message.map !== this.player.worldMap || message.server_id !== this.serverId || (message.map === ROOM_MAP && !validRoomPosition(message.spawn))) { this.roomRequired(); return; }
      this.id = message.id;
      if (message.map === 'planet' && !this.player.planetSpawned) {
        this.player.spawn?.(this.id); this.player.planetSpawned = true;
      }
      this.rtcConfig = message.rtc_config || { iceServers: [] };
      if (this.voice) { this.voice.online = true; this.voice.onChange(); }
      this.sequence = 0;
      this.status = 'В сети';
      for (const id of message.peers) this.addPeer(id);
      if (message.world_protocol === 1) this.startWorld();
    }
    if (type === 'joined') this.addPeer(message.id);
    if (type === 'left') {
      this.voice?.remove(message.id);
      this.peers.get(message.id)?.pc.close();
      this.peers.delete(message.id);
      this.remotes.get(message.id)?.node.dispose(false, true);
      this.remotes.delete(message.id);
      this.planet.actors.delete(message.id);
    }
    if (type === 'sdp' || type === 'ice') {
      const peer = this.peers.get(message.from);
      if (peer) peer.signals = peer.signals.then(() => {
        if (this.peers.get(message.from) === peer) return this.peerSignal(message);
      }).catch(error => console.warn('Peer negotiation:', error));
    }
    if (type === 'server_sdp' && this.worldPC) {
      const pc = this.worldPC;
      pc.setRemoteDescription({ type: message.description, sdp: message.sdp }).then(async () => {
        if (this.worldPC !== pc) return;
        for (const candidate of this.worldIce.splice(0)) await pc.addIceCandidate(candidate);
      }).catch(error => console.warn('World negotiation:', error));
    }
    if (type === 'server_ice' && this.worldPC) {
      const candidate = { candidate: message.candidate, sdpMid: message.media, sdpMLineIndex: message.index };
      if (this.worldPC.remoteDescription) this.worldPC.addIceCandidate(candidate).catch(() => {});
      else if (this.worldIce.length < 64) this.worldIce.push(candidate);
    }
  }

  addPeer(id) {
    if (this.peers.has(id) || id === this.id) return;
    const pc = new RTCPeerConnection(this.rtcConfig);
    const peer = { pc, dc: null, control: null, ice: [], ping: null, pingAt: 0, signals: Promise.resolve() };
    this.peers.set(id, peer);
    this.voice?.attach(id, pc, this.id < id);
    pc.onicecandidate = event => {
      if (event.candidate && this.peers.get(id) === peer) this.send({ type: 'ice', to: id, media: event.candidate.sdpMid,
        index: event.candidate.sdpMLineIndex, candidate: event.candidate.candidate });
    };
    pc.ondatachannel = event => this.bindPeer(id, event.channel);
    // Same offerer rule as the original C++ / Godot signaling protocol.
    if (this.id < id) {
      this.bindPeer(id, pc.createDataChannel('players-v1', { ordered: false, maxRetransmits: 0 }));
      this.bindPeer(id, pc.createDataChannel('control-v1', { ordered: true }));
      this.offerPeer(id);
    }
  }

  async offerPeer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    try {
      await this.voice?.peers.get(id)?.updates;
      if (this.peers.get(id) !== peer) return;
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      if (this.peers.get(id) === peer) this.send({ type: 'sdp', to: id, description: 'offer', sdp: peer.pc.localDescription.sdp });
    } catch (error) { console.warn('Peer offer:', error); }
  }

  bindPeer(id, channel) {
    const peer = this.peers.get(id);
    if (!peer) return;
    if (channel.label === 'control-v1') peer.control = channel;
    else if (channel.label === 'players-v1') peer.dc = channel;
    else { channel.close(); return; }
    channel.onopen = () => {
      if (this.peers.get(id) !== peer || channel.readyState !== 'open') return;
      const state = this.player.state(++this.sequence);
      channel.send(JSON.stringify(state));
      if (channel.label === 'control-v1') peer.avatarId = state.avatarId;
    };
    channel.onmessage = event => {
      if (this.peers.get(id) !== peer) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'state') { this.apply(id, message); this.rx++; }
        if (message.type === 'ping') channel.send(JSON.stringify({ type: 'pong', sent: message.sent }));
        if (message.type === 'pong') { peer.ping = Math.round(performance.now() - message.sent); peer.pingAt = performance.now(); }
      } catch { /* Discard malformed remote data. */ }
    };
  }

  async peerSignal(message) {
    const peer = this.peers.get(message.from);
    if (!peer) return;
    if (message.type === 'ice') {
      const candidate = { candidate: message.candidate, sdpMid: message.media, sdpMLineIndex: message.index };
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(candidate);
      else if (peer.ice.length < 64) peer.ice.push(candidate);
      return;
    }
    await peer.pc.setRemoteDescription({ type: message.description, sdp: message.sdp });
    if (this.peers.get(message.from) !== peer) return;
    for (const candidate of peer.ice.splice(0)) await peer.pc.addIceCandidate(candidate);
    if (message.description === 'offer') {
      await this.voice?.prepareAnswer(message.from);
      await peer.pc.setLocalDescription(await peer.pc.createAnswer());
      if (this.peers.get(message.from) === peer) this.send({ type: 'sdp', to: message.from, description: 'answer', sdp: peer.pc.localDescription.sdp });
    }
  }

  async startWorld() {
    this.worldPC?.close();
    this.worldAttempt = performance.now();
    this.worldIce = [];
    this.worldSequence = 0;
    this.lastWorldSend = 0;
    this.fish.reset();
    this.worldTransport = 'соединение WebRTC…';
    this.send({ type: 'server_reset' });
    const pc = new RTCPeerConnection(this.rtcConfig);
    this.worldPC = pc;
    const channel = pc.createDataChannel('world-v1', { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 });
    this.worldChannel = channel;
    pc.onicecandidate = event => {
      if (event.candidate && this.worldPC === pc) this.send({ type: 'server_ice',
        media: event.candidate.sdpMid, index: event.candidate.sdpMLineIndex, candidate: event.candidate.candidate });
    };
    channel.onmessage = event => {
      if (this.worldPC !== pc) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type !== 'world' || message.map !== this.player.worldMap || message.server_id !== this.serverId || !Number.isSafeInteger(message.sequence) || message.sequence <= this.worldTick) return;
        this.worldTransport = 'WebRTC';
        this.worldReceived = performance.now(); this.worldTick = message.sequence;
        if (Array.isArray(message.players)) for (const state of message.players) {
          if (state.id !== this.id && this.peers.has(state.id)) { this.apply(state.id, state); this.rx++; }
        }
        if (Number.isFinite(message.echo)) {
          this.ping = Math.max(0, Math.round(performance.now() - message.echo));
          this.pingAt = performance.now();
        }
      } catch { /* Ignore malformed snapshots. */ }
    };
    try {
      await pc.setLocalDescription(await pc.createOffer());
      if (this.worldPC === pc) this.send({ type: 'server_sdp', description: 'offer', sdp: pc.localDescription.sdp });
    } catch { this.worldTransport = 'ошибка WebRTC'; }
  }

  apply(id, state) {
    if (!validState(state, this.player.worldMap)) return;
    let remote = this.remotes.get(id);
    // Server world snapshots carry pose only; retain peer appearance metadata.
    const avatarId = state.avatarId === undefined ? remote?.avatarId || DEFAULT_AVATAR : findAvatar(state.avatarId)?.id || DEFAULT_AVATAR;
    if (!remote) {
      const avatar = new LocalAvatar(this.scene, avatarId, id);
      remote = { avatar, avatarId, node: avatar.root, sequence: -1, last: 0 };
      this.remotes.set(id, remote);
    }
    if (state.sequence <= remote.sequence) return;
    if (remote.avatarId !== avatarId) {
      remote.avatarId = avatarId;
      void remote.avatar.select(avatarId);
    }
    const first = remote.sequence < 0;
    remote.sequence = state.sequence;
    remote.last = performance.now();
    remote.state = { ...state, speed: state.speed ?? remote.state?.speed ?? 0 };
    remote.target = vec(state.position);
    remote.rotation = B.Quaternion.FromArray(state.rotation);
    if (first) {
      remote.node.position.copyFrom(remote.target);
      remote.node.rotationQuaternion.copyFrom(remote.rotation);
    }
    remote.avatar.update(0, remote.state.speed, state.pitch, true);
  }

  update(dt) {
    if (this.auth.token && Date.now() >= this.auth.expiresAt) { this.requireAuth(); return; }
    const now = performance.now();
    if (this.id && this.socket?.readyState === WebSocket.OPEN) {
      if (now - this.lastSend >= 50) {
        this.lastSend = now;
        const state = this.player.state(++this.sequence), raw = JSON.stringify(state);
        for (const peer of this.peers.values()) {
          if (peer.dc?.readyState === 'open' && peer.dc.bufferedAmount < 65536) peer.dc.send(raw);
          // Appearance changes also use the reliable channel; late joiners get
          // the complete current state in onopen, without a new negotiation.
          if (peer.avatarId !== state.avatarId && peer.control?.readyState === 'open' && peer.control.bufferedAmount < 65536) {
            peer.control.send(raw);
            peer.avatarId = state.avatarId;
          }
        }
      }
      if (now - this.lastWorldSend >= 100 && this.worldChannel?.readyState === 'open') {
        this.lastWorldSend = now;
        this.worldChannel.send(JSON.stringify({ ...this.player.state(++this.sequence), type: 'player', sent: now }));
      }
      if (now - this.lastPing >= 1000) {
        this.lastPing = now;
        for (const peer of this.peers.values()) if (peer.control?.readyState === 'open') peer.control.send(JSON.stringify({ type: 'ping', sent: now }));
      }
      if (now - Math.max(this.worldAttempt, this.worldReceived) > 10000) this.startWorld();
      if (this.worldReceived && now - this.worldReceived > 3000) this.worldTransport = 'ожидание сервера…';
    }
    for (const [id, remote] of this.remotes) {
      remote.node.position = B.Vector3.Lerp(remote.node.position, remote.target, 1 - Math.exp(-dt * 12));
      remote.node.rotationQuaternion = B.Quaternion.Slerp(remote.node.rotationQuaternion, remote.rotation, 1 - Math.exp(-dt * 12));
      remote.avatar.update(dt, now - remote.last < 1000 ? remote.state.speed || 0 : 0, remote.state.pitch, true);
      this.planet.updateActor(id, remote.node.position, dt);
    }
  }
}
