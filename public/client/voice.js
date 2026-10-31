// Audio uses the authenticated peer connections negotiated by the C++ server.
// Reserve audio before the first offer so microphone changes need no renegotiation.
export class VoiceChat {
  constructor(onChange = () => {}) {
    this.onChange = onChange;
    this.peers = new Map();
    this.online = false;
    this.muted = false;
    this.pending = false;
    this.generation = 0;
    this.error = '';
  }

  get enabled() { return !!this.stream; }
  get status() {
    if (!this.online) return 'Голос · войдите в общий мир';
    if (this.error) return this.error;
    if (this.pending) return 'Разрешите доступ к микрофону…';
    if (this.stream?.getAudioTracks().some(track => track.muted)) return 'Браузер приостановил микрофон · проверьте другую вкладку или устройство';
    const connected = [...this.peers.values()].filter(p => p.pc.connectionState === 'connected').length;
    const failed = [...this.peers.values()].some(p => p.pc.connectionState === 'failed');
    return `Микрофон ${this.enabled ? 'включён' : 'выключен'} · собеседников ${connected}${this.muted ? ' · входящий звук выключен' : ''}${failed ? ' · нет связи: переподключитесь' : ''}`;
  }

  attach(id, pc, offerer) {
    // Only the offerer creates the transceiver. The answerer uses the one
    // created by setRemoteDescription; a second local transceiver is not paired.
    const sender = offerer ? pc.addTransceiver('audio', { direction: 'sendrecv' }).sender : null;
    const peer = { pc, sender, audio: null, blocked: false, updates: Promise.resolve() };
    this.peers.set(id, peer);
    this.replace(peer, this.stream?.getAudioTracks()[0] || null);
    pc.ontrack = event => {
      if (event.track.kind !== 'audio' || this.peers.get(id) !== peer) return;
      if (peer.audio) { peer.audio.pause(); peer.audio.srcObject = null; peer.audio.remove(); }
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.setAttribute('playsinline', '');
      audio.hidden = true;
      audio.muted = this.muted;
      audio.srcObject = new MediaStream([event.track]);
      document.body.append(audio);
      peer.audio = audio;
      event.track.onunmute = () => { if (this.peers.get(id) === peer) this.play(peer); };
      this.play(peer);
    };
    pc.addEventListener('connectionstatechange', () => this.onChange());
    this.onChange();
  }

  replace(peer, track) {
    peer.updates = peer.updates.then(async () => {
      if (peer.sender && peer.pc.signalingState !== 'closed') await peer.sender.replaceTrack(track);
    }).catch(() => {
      if (peer.pc.signalingState !== 'closed') {
        this.error = 'Не удалось передать микрофон · переподключитесь';
        this.onChange();
      }
    });
  }

  async prepareAnswer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    const audio = peer.pc.getTransceivers().find(t => t.receiver.track.kind === 'audio');
    if (!audio) return; // A client without voice can still use the game channels.
    audio.direction = 'sendrecv';
    peer.sender = audio.sender;
    this.replace(peer, this.stream?.getAudioTracks()[0] || null);
    await peer.updates;
  }

  play(peer) {
    if (!peer.audio) return;
    peer.audio.play().then(() => { peer.blocked = false; this.onChange(); }).catch(() => {
      peer.blocked = true;
      this.onChange();
    });
  }

  unlock() { for (const peer of this.peers.values()) if (peer.audio?.paused) this.play(peer); }
  get playbackBlocked() { return [...this.peers.values()].some(peer => peer.blocked); }

  async toggle() {
    this.unlock();
    if (this.enabled || this.pending) { this.stop(); return; }
    if (!this.online) return;
    this.error = '';
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.error = 'Для микрофона нужен HTTPS или localhost'; this.onChange(); return;
    }
    const generation = ++this.generation;
    this.pending = true;
    this.onChange();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false
      });
      if (generation !== this.generation || !this.online) { stream.getTracks().forEach(track => track.stop()); return; }
      const track = stream.getAudioTracks()[0];
      if (!track) { stream.getTracks().forEach(t => t.stop()); throw Error('No audio track'); }
      this.stream = stream;
      track.onmute = track.onunmute = () => this.onChange();
      track.onended = () => {
        if (this.stream !== stream) return;
        this.stop(); this.error = 'Микрофон отключён · включите снова'; this.onChange();
      };
      for (const peer of this.peers.values()) this.replace(peer, track);
      await Promise.all([...this.peers.values()].map(peer => peer.updates));
      if (generation !== this.generation) return;
      // Safari can allow MediaStream playback only after capture starts.
      this.unlock();
    } catch (error) {
      if (generation !== this.generation) return;
      this.error = error.name === 'NotAllowedError' ? 'Доступ к микрофону запрещён · проверьте разрешения сайта' :
        error.name === 'NotFoundError' ? 'Микрофон не найден' : 'Микрофон недоступен · проверьте устройство';
    } finally {
      if (generation === this.generation) { this.pending = false; this.onChange(); }
    }
  }

  stop() {
    ++this.generation;
    this.pending = false;
    this.stream?.getTracks().forEach(track => { track.onended = track.onmute = track.onunmute = null; track.stop(); });
    this.stream = null;
    for (const peer of this.peers.values()) this.replace(peer, null);
    this.error = '';
    this.onChange();
  }

  togglePlayback() {
    this.muted = !this.muted;
    for (const peer of this.peers.values()) if (peer.audio) peer.audio.muted = this.muted;
    if (!this.muted) this.unlock();
    this.onChange();
  }

  remove(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.pc.ontrack = null;
    for (const receiver of peer.pc.getReceivers()) receiver.track.onunmute = null;
    if (peer.audio) { peer.audio.pause(); peer.audio.srcObject = null; peer.audio.remove(); }
    this.peers.delete(id);
    this.onChange();
  }

  disconnect() {
    this.online = false;
    this.stop();
    for (const id of this.peers.keys()) this.remove(id);
  }
}
