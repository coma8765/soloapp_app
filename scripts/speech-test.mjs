import assert from 'node:assert/strict';
import { PCMResampler, SpeechWindows, TranscriptTimeline, SpeechTrack, encodeWav } from '../public/client/speech-audio.js';

for (const rate of [44100, 48000]) {
  const resampler = new PCMResampler(rate), result = [];
  for (let offset = 0; offset < rate; offset += 128) result.push(...resampler.push(new Float32Array(Math.min(128, rate-offset)).fill(.25)));
  assert.equal(result.length, 16000); assert(result.every(x => Math.abs(x-.25) < 1e-6));
}
const chunks = [], input = Float32Array.from({length: 17*16000}, (_,i) => i);
const windows = new SpeechWindows((audio,start,final)=>chunks.push({audio,start,final}));
for (let i=0; i<input.length; i+=2048) windows.push(input.subarray(i,i+2048));
windows.flush(); windows.flush();
assert.deepEqual(chunks.map(c=>[c.start,c.audio.length,c.final]), [[0,128000,false],[6,128000,false],[12,80000,true]]);
for (const c of chunks) assert.deepEqual(c.audio, input.slice(c.start*16000,c.start*16000+c.audio.length));
assert(windows.buffer.every(x=>x===0));
const wav = new DataView(encodeWav(Float32Array.of(-2,0,2)));
assert.equal(wav.getUint32(24,true),16000); assert.equal(wav.getInt16(44,true),-32768); assert.equal(wav.getInt16(48,true),32767);

const timeline = new TranscriptTimeline();
timeline.merge([{word:'Начало',start:0,end:1},{word:'границы',start:6.6,end:7.2},{word:'фразы',start:7.3,end:7.9}],0,8,false);
assert.equal(timeline.merge([{word:'границы',start:.6,end:1.2},{word:'фразы',start:1.3,end:1.9},{word:'да',start:2,end:2.2},{word:'да',start:2.3,end:2.6}],6,4,true), 'Начало границы фразы да да');
const silentTail = new TranscriptTimeline();
silentTail.merge([{word:'конец',start:7.1,end:7.8}],0,8,false);
assert.equal(silentTail.merge([],6,2,true),'конец');
const silentNext = new TranscriptTimeline();
silentNext.merge([{word:'хвост',start:7.1,end:7.8}],0,8,false);
assert.equal(silentNext.merge([],6,8,false),'хвост');

const received = [], texts = new Map(), errors = [];
const tracks = ['speaker-a/lake-1','speaker-b/lake-1','speaker-a/lake-2'].map((key,index)=>new SpeechTrack({
  speaker:key.split('/')[0], lake:key.split('/')[1],
  transcribe: async audio => { await new Promise(r=>setTimeout(r,index*2)); received.push([key,audio[0],audio]); return [{word:key,start:0,end:.1}]; },
  onText: text=>texts.set(key,text), onError: error=>errors.push(error),
}));
tracks.forEach((track,i)=>track.push(new Float32Array(16000).fill(i+1)));
await Promise.all(tracks.map(track=>track.finish()));
assert.equal(errors.length,0); assert.equal(texts.size,3);
for (let i=0;i<3;i++) { assert.equal(received[i][1],i+1); assert.equal(texts.get(received[i][0]),received[i][0]); assert(received[i][2].every(x=>x===0)); }
let release, lateText=false;
const cancelled = new SpeechTrack({speaker:'a',lake:0,transcribe:()=>new Promise(r=>{release=r;}),onText:()=>{lateText=true;},onError:()=>{}});
cancelled.push(new Float32Array(128000)); await Promise.resolve(); cancelled.cancel(); release([{word:'late',start:0,end:1}]); await cancelled.finish(); assert.equal(lateText,false);
const order=[];
const ordered = new SpeechTrack({speaker:'a',lake:1,transcribe:async a=>{ order.push(a[0]); return []; },onText:()=>{},onError:error=>{throw error;}});
ordered.push(input); await ordered.finish(); assert.deepEqual(order,[0,96000,192000]);
console.log('PASS: 44.1/48 kHz resampling, exact overlap/tail, PCM WAV, boundary deduplication, repeated words, silence fallback, isolated speakers/lakes, FIFO and cancellation');
