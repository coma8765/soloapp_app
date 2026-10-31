import { SpeechTrack, transcribeWindow } from './speech-audio.js';

// Borrows the voice chat stream. Only VoiceChat owns microphone permissions,
// track handlers and track lifetime; stopping transcription never stops chat.
export class ProfessorRecorder {
  constructor(onChange = () => {}) {
    this.onChange = onChange; this.records = new Map(); this.tracks = new Map(); this.speaker = crypto.randomUUID();
    this.generation = 0; this.pending = false; this.target = null; this.error = '';
    this.voiceStream = null; this.connection = Promise.resolve();
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
  finishTrack() { this.track = null; this.node?.port.postMessage({ route: null }); }

  setVoiceStream(stream) {
    stream = stream?.getAudioTracks().some(track => track.readyState === 'live' && track.enabled) ? stream : null;
    if (this.voiceStream === stream) return this.connection;
    this.error = ''; return this.transition(stream, true);
  }
  transition(stream, flush) {
    this.voiceStream = stream; const generation = ++this.generation;
    this.finishTrack(); this.stream = null; this.pending = !!stream; this.onChange();
    this.connection = this.connection.then(async () => {
      await this.release(flush);
      if (generation !== this.generation) return;
      if (stream) await this.start(stream, generation);
      if (generation === this.generation) { this.pending = false; this.onChange(); }
    });
    return this.connection;
  }
  async start(stream, generation) {
    let context;
    try {
      context = new AudioContext(); await context.resume();
      const health = await fetch('/api/professors/health', { signal: AbortSignal.timeout(5000), cache: 'no-store' });
      if (!health.ok) throw Error('Запустите локальный Whisper: scripts/start-whisper.sh');
      if (generation !== this.generation) return;
      await context.audioWorklet.addModule('/client/speech-worklet.js');
      if (generation !== this.generation || !stream.getAudioTracks().some(track => track.readyState === 'live' && track.enabled)) return;
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
      if (this.target !== null) this.beginTrack(); context = null;
    } catch (error) {
      if (generation === this.generation) this.error = error.message;
    } finally { if (context) await context.close(); }
  }
  async release(flush) {
    const node = this.node, context = this.context, source = this.source;
    this.stream = this.context = this.node = this.source = null;
    if (node && flush) await new Promise(resolve => {
      const timer = setTimeout(resolve, 150); this.flushed = () => { clearTimeout(timer); resolve(); }; node.port.postMessage('flush');
    });
    this.flushed = null; source?.disconnect(); node?.disconnect(); if (context) await context.close();
    this.track = null;
    for (const [id, track] of this.tracks) {
      if (flush) void track.finish().finally(() => { this.tracks.delete(id); this.onChange(); }); else track.cancel();
    }
    if (!flush) this.tracks.clear();
  }
  stop(flush = true) { return this.transition(null, flush); }
  clear() {
    for (const track of this.tracks.values()) track.cancel(); this.tracks.clear(); this.records.clear();
    this.target = null; void this.stop(false); this.error = ''; this.onChange();
  }
}
