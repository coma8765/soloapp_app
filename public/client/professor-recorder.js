import { SpeechTrack, transcribeWindow } from './speech-audio.js';

export class ProfessorRecorder {
  constructor(onChange = () => {}) {
    this.onChange = onChange; this.records = new Map(); this.tracks = new Map(); this.speaker = crypto.randomUUID();
    this.generation = 0; this.pending = false; this.target = null; this.error = '';
  }
  get enabled() { return !!this.stream; }
  record(lake) {
    if (!this.records.has(lake)) this.records.set(lake, { text: '', segments: [] });
    return this.records.get(lake);
  }
  setTarget(lake) {
    if (lake === this.target) return;
    this.finishTrack(); this.target = lake;
    if (this.enabled && lake !== null) this.beginTrack();
    this.onChange();
  }
  beginTrack() {
    if (this.tracks.size >= 16) { this.error = 'Дождитесь завершения распознавания'; void this.stop(); return; }
    const lake = this.target, record = this.record(lake), segment = { text: '' }, id = crypto.randomUUID();
    record.segments.push(segment); record.segments = record.segments.slice(-24);
    const track = new SpeechTrack({ speaker: this.speaker, lake, transcribe: transcribeWindow,
      onText: text => { segment.text = text; record.text = record.segments.map(s => s.text).filter(Boolean).join(' ').slice(-3000); this.onChange(); },
      onError: error => { this.error = error.message; void this.stop(false); this.onChange(); },
    });
    this.track = track; this.tracks.set(id, track); this.node.port.postMessage({ route: id });
  }
  finishTrack() {
    this.track = null;
    this.node?.port.postMessage({ route: null });
  }
  async toggle() {
    if (this.stopping) return;
    if (this.enabled || this.pending) { await this.stop(); return; }
    if (this.target === null) { this.error = 'Подойдите к профессору у озера'; this.onChange(); return; }
    this.pending = true; this.error = ''; const generation = ++this.generation; this.onChange();
    let stream, context;
    try {
      // Resume within the user gesture; no automatic microphone permission.
      context = new AudioContext(); await context.resume();
      const health = await fetch('/api/professors/health', { signal: AbortSignal.timeout(5000), cache: 'no-store' });
      if (!health.ok) throw Error('Запустите локальный Whisper: scripts/start-whisper.sh');
      if (generation !== this.generation) return;
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }, video: false });
      if (generation !== this.generation || this.target === null) return;
      await context.audioWorklet.addModule('/client/speech-worklet.js');
      if (generation !== this.generation || this.target === null) return;
      const node = new AudioWorkletNode(context, 'professor-speech');
      const source = context.createMediaStreamSource(stream), silent = context.createGain(); silent.gain.value = 0;
      source.connect(node).connect(silent).connect(context.destination);
      this.stream = stream; this.context = context; this.node = node; this.source = source;
      node.port.onmessage = event => {
        const { samples, route, closed, flushed } = event.data;
        if (samples) this.tracks.get(route)?.push(samples);
        if (closed) { const track = this.tracks.get(closed); if (track) void track.finish().finally(() => this.tracks.delete(closed)); }
        if (flushed) this.flushed?.();
      };
      for (const track of stream.getTracks()) track.onended = () => { this.error = 'Микрофон отключён'; void this.stop(); };
      this.beginTrack(); stream = context = null;
    } catch (error) {
      if (generation === this.generation) this.error = error.name === 'NotAllowedError' ? 'Доступ к микрофону запрещён' : error.message;
    } finally {
      stream?.getTracks().forEach(track => track.stop()); if (context) void context.close();
      if (generation === this.generation) this.pending = false;
      this.onChange();
    }
  }
  async stop(flush = true) {
    if (this.stopping) return;
    this.stopping = true;
    ++this.generation; this.pending = false;
    const node = this.node, context = this.context, source = this.source, stream = this.stream;
    this.stream = this.context = this.node = this.source = null;
    stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    if (node && flush) await new Promise(resolve => {
      const timer = setTimeout(resolve, 150); this.flushed = () => { clearTimeout(timer); resolve(); }; node.port.postMessage('flush');
    });
    this.flushed = null; source?.disconnect(); node?.disconnect(); if (context) void context.close();
    this.track = null;
    for (const [id, track] of this.tracks) {
      if (flush) void track.finish().finally(() => { this.tracks.delete(id); this.onChange(); }); else track.cancel();
    }
    if (!flush) this.tracks.clear();
    this.stopping = false;
    this.onChange();
  }
  clear() {
    for (const track of this.tracks.values()) track.cancel(); this.tracks.clear(); this.records.clear();
    this.target = null; void this.stop(false); this.error = ''; this.onChange();
  }
}
