export const SAMPLE_RATE = 16000, WINDOW_SAMPLES = 8 * SAMPLE_RATE, OVERLAP_SAMPLES = 2 * SAMPLE_RATE;

// Streaming area resampling preserves fractional sample boundaries (44.1/48 kHz).
export class PCMResampler {
  constructor(inputRate) { this.ratio = inputRate / SAMPLE_RATE; this.weight = 0; this.sum = 0; }
  push(input) {
    const result = [];
    for (const sample of input) {
      let left = 1;
      while (left > 1e-9) {
        const weight = Math.min(left, this.ratio - this.weight);
        this.sum += sample * weight; this.weight += weight; left -= weight;
        if (this.weight >= this.ratio - 1e-9) {
          result.push(this.sum / this.ratio); this.weight = this.sum = 0;
        }
      }
    }
    return Float32Array.from(result);
  }
}

// A separate instance belongs to exactly one speaker at one lake. It never
// receives another speaker's samples or audio from the game's output mixer.
export class SpeechWindows {
  constructor(emit) { this.emit = emit; this.buffer = new Float32Array(WINDOW_SAMPLES); this.length = 0; this.start = 0; this.closed = false; }
  push(samples) {
    if (this.closed) return;
    let cursor = 0;
    while (cursor < samples.length) {
      const count = Math.min(samples.length - cursor, WINDOW_SAMPLES - this.length);
      this.buffer.set(samples.subarray(cursor, cursor + count), this.length); this.length += count; cursor += count;
      if (this.length === WINDOW_SAMPLES) {
        this.emit(this.buffer.slice(), this.start / SAMPLE_RATE, false);
        this.buffer.copyWithin(0, WINDOW_SAMPLES - OVERLAP_SAMPLES);
        this.start += WINDOW_SAMPLES - OVERLAP_SAMPLES; this.length = OVERLAP_SAMPLES;
      }
    }
  }
  flush() {
    if (this.closed) return;
    this.closed = true;
    if (this.length) this.emit(this.buffer.slice(0, this.length), this.start / SAMPLE_RATE, true);
    this.buffer.fill(0); this.length = 0;
  }
}

export function encodeWav(samples) {
  const bytes = new ArrayBuffer(44 + samples.length * 2), data = new DataView(bytes);
  const text = (offset, value) => { for (let i = 0; i < value.length; i++) data.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); data.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true);
  data.setUint32(24, SAMPLE_RATE, true); data.setUint32(28, SAMPLE_RATE * 2, true);
  data.setUint16(32, 2, true); data.setUint16(34, 16, true); text(36, 'data'); data.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => data.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767)), true));
  return bytes;
}

const token = word => word.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export class TranscriptTimeline {
  constructor() { this.words = []; this.pending = []; this.boundary = 0; }
  merge(words, start, duration, final) {
    const end = start + duration, cutoff = final ? end + .01 : end - OVERLAP_SAMPLES / SAMPLE_RATE / 2;
    const current = words.filter(w => typeof w.word === 'string' && w.word.length < 200 &&
      Number.isFinite(w.start) && Number.isFinite(w.end) && w.start >= 0 && w.end >= w.start && w.end <= duration + .5)
      .map(w => ({ word: w.word, start: start + w.start, end: start + w.end }));
    // Prefer the new observation in the overlap. If the final short tail is
    // silent/undecodable, retain the preceding full window's tentative words.
    const observed = current.length ? current : this.pending;
    const stable = observed.filter(w => (w.start + w.end) / 2 >= this.boundary && (w.start + w.end) / 2 < cutoff);
    for (const word of stable) {
      const previous = this.words.at(-1);
      // Timestamp-constrained deduplication keeps genuine repeated words later.
      if (previous && token(previous.word) === token(word.word) && word.start < previous.end - .01) continue;
      this.words.push(word);
    }
    this.words = this.words.slice(-160);
    this.pending = final ? [] : current.filter(w => (w.start + w.end) / 2 >= cutoff);
    this.boundary = Math.max(this.boundary, cutoff);
    return this.text;
  }
  get text() { return [...this.words, ...this.pending].map(w => w.word.trim()).join(' '); }
}

export class SpeechTrack {
  constructor({ speaker, lake, transcribe, onText, onError }) {
    Object.assign(this, { speaker, lake, transcribe, onText, onError });
    this.timeline = new TranscriptTimeline(); this.jobs = 0; this.cancelled = false; this.chain = Promise.resolve();
    this.windows = new SpeechWindows((audio, start, final) => this.enqueue(audio, start, final));
  }
  enqueue(audio, start, final) {
    if (this.cancelled) { audio.fill(0); return; }
    if (this.jobs >= 8) { audio.fill(0); this.cancel(); this.onError(Error('Whisper не успевает: запись остановлена.')); return; }
    this.jobs++;
    this.chain = this.chain.then(async () => {
      if (this.cancelled) return;
      const words = await this.transcribe(audio);
      if (!this.cancelled) this.onText(this.timeline.merge(words, start, audio.length / SAMPLE_RATE, final));
    }).catch(error => { if (!this.cancelled) { this.cancel(); this.onError(error); } })
      .finally(() => { audio.fill(0); this.jobs--; });
  }
  push(samples) { if (!this.cancelled) this.windows.push(samples); }
  finish() { this.windows.flush(); return this.chain; }
  cancel() { this.cancelled = true; this.windows.closed = true; this.windows.buffer.fill(0); }
}

export async function transcribeWindow(samples) {
  const body = encodeWav(samples);
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch('/api/professors/transcribe', {
      method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body,
      signal: AbortSignal.timeout(95000), cache: 'no-store', credentials: 'omit',
    });
    if (response.status === 429 && attempt < 4) { await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1))); continue; }
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Ошибка локального распознавания');
    if (!Array.isArray(data.words)) throw Error('Некорректный ответ Whisper');
    return data.words;
  }
}
