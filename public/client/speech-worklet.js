import { PCMResampler } from './speech-audio.js';
class SpeechCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.resampler = new PCMResampler(sampleRate); this.buffer = new Float32Array(2048); this.length = 0; this.route = null;
    this.port.onmessage = event => {
      if (event.data === 'flush' || Object.hasOwn(event.data, 'route')) {
        if (this.length && this.route) this.port.postMessage({ samples: this.buffer.slice(0, this.length), route: this.route });
        if (this.route) this.port.postMessage({ closed: this.route });
        this.length = 0; this.resampler = new PCMResampler(sampleRate);
        this.route = event.data === 'flush' ? null : event.data.route;
        if (event.data === 'flush') this.port.postMessage({ flushed: true });
      }
    };
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length || !this.route) return true;
    const mono = new Float32Array(channels[0].length);
    for (const channel of channels) for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
    for (const sample of this.resampler.push(mono)) {
      this.buffer[this.length++] = sample;
      if (this.length === this.buffer.length) { this.port.postMessage({ samples: this.buffer, route: this.route }); this.buffer = new Float32Array(2048); this.length = 0; }
    }
    return true;
  }
}
registerProcessor('professor-speech', SpeechCaptureProcessor);
