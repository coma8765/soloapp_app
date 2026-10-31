// Optional integration test tooling; the application itself has no Node dependency.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { mkdtemp, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium, webkit } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const listener = net.createServer().listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const webRoot = await mkdtemp(join(tmpdir(),'planet-voice-'));
for (const name of ['index.html','client','shared','assets','vendor']) await symlink(`${root}/public/${name}`,`${webRoot}/${name}`);
const server = spawn(`${root}/build/planet_server`, [`--port=${port}`, '--auth-db=:memory:', `--web=${webRoot}`], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PLANET_RTC_CONFIG: '' }
});
let logs = '';
server.stdout.on('data', data => { logs += data; });
server.stderr.on('data', data => { logs += data; });
let browser;
const extraBrowsers = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready(page, count) {
  try { await page.waitForFunction(n => network.id && network.peers.size === n &&
    [...network.peers.values()].every(p => p.pc.connectionState === 'connected' && p.dc?.readyState === 'open') &&
    network.fish.sequence >= 0, count, { timeout: 25000 }); } catch(error) { console.error('Readiness:',await page.evaluate(()=>({id:network.id,status:network.status,world:network.worldPC?.connectionState,fish:network.fish.sequence,peers:[...network.peers].map(([id,p])=>({id,connection:p.pc.connectionState,ice:p.pc.iceConnectionState,signal:p.pc.signalingState,dc:p.dc?.readyState,transceivers:p.pc.getTransceivers().map(t=>({mid:t.mid,direction:t.currentDirection}))}))}))); throw error; }
}
async function audioReceived(page, count) {
  let rows = [];
  for (let attempt = 0; attempt < 125; attempt++) {
    rows = await page.evaluate(() => receivedAudio());
    if (rows.filter(s => s.packets > 5 && s.energy > 0.0001).length >= count) return rows;
    await delay(200);
  }
  throw Error(`Expected ${count} audible peers: ${JSON.stringify(rows)}`);
}
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(origin)).ok) break; } catch {}
    if (i > 100 || server.exitCode !== null) throw Error(`Server not ready: ${logs}`);
    await delay(100);
  }
  browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  });
  const errors = [];
  async function client(index) {
    const useWebKit = process.env.VOICE_WEBKIT && (index === 2 || (process.env.VOICE_WEBKIT === 'all' && index === 1));
    let clientBrowser = browser;
    if (useWebKit) {
      clientBrowser = await webkit.launch({headless:true});
      extraBrowsers.push(clientBrowser);
    }
    const context = await clientBrowser.newContext();
    if (!useWebKit) await context.grantPermissions(['local-network-access'], {origin});
    if (useWebKit) await context.addInitScript(() => {
      // WebKit's automation does not grant microphone permission. Only replace
      // the capture device; SDP, ICE, Opus, TURN and the audio player are real.
      const syntheticMicrophone = async () => {
        const context = new AudioContext(); await context.resume();
        const source = context.createOscillator(); source.frequency.value = 660;
        const gain = context.createGain(); gain.gain.value = .1;
        const destination = context.createMediaStreamDestination();
        source.connect(gain); gain.connect(destination); source.start();
        const track = destination.stream.getAudioTracks()[0];
        const stop = track.stop.bind(track);
        track.stop = () => { stop(); source.stop(); void context.close(); };
        return destination.stream;
      };
      // WebKit may recreate navigator.mediaDevices after it is garbage collected.
      Object.defineProperty(MediaDevices.prototype, 'getUserMedia', {configurable:true,writable:true,value:syntheticMicrophone});
    });
    const page = await context.newPage();
    page.on('pageerror', error => {errors.push(error.message);console.error('Browser error:',error.message);});
    page.on('console', msg=>{if(['warning','error'].includes(msg.type()))console.error('Browser:',msg.text());});
    await writeFile(`${webRoot}/voice-test-${index}.html`, `<!doctype html><button id="mic">Mic</button><button id="unlock">Play voices</button><script type="module">
      import {Network} from '/client/network.js';
      import {VoiceChat} from '/client/voice.js';
      window.VoiceChat=VoiceChat;
      window.voice=new VoiceChat();
      const response=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'voice${index}@example.com',password:'voice-test-password'})});
      const account=await response.json();
      const auth={token:account.token,expiresAt:account.expires_at*1000,clear(){this.token=null;}};
      const player={state:()=>({type:'test'}),position:{asArray:()=>[0,35,-10]}};
      const fish={last:0,sequence:-1,reset(){this.last=0;this.sequence=-1;},snapshot(s){this.last=performance.now();this.sequence=s.sequence;}};
      window.network=new Network(null,player,fish,{actors:new Map()},auth,()=>{},voice);
      document.getElementById('mic').onclick=()=>voice.toggle();
      document.getElementById('unlock').onclick=()=>voice.unlock();
      setInterval(()=>network.update(.05),50);
      window.receivedAudio=async()=>{const rows=[];for(const [id,p] of network.peers)for(const s of (await p.pc.getStats()).values())if(s.type==='inbound-rtp'&&s.kind==='audio')rows.push({id,packets:s.packetsReceived,energy:s.totalAudioEnergy});return rows;};
      </script>`);
    // Rendering is irrelevant to this test; WebSocket, SDP, ICE, audio and world channels are real.
    await page.route('**/client/scene.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export const avatar=()=>{}; export const vec=a=>a;' }));
    await page.goto(`${origin}/voice-test-${index}.html`);
    try { await page.waitForFunction(() => window.network?.id); } catch(error) { console.error('Client state:',await page.evaluate(()=>({network:!!window.network,status:window.network?.status,error:window.voice?.error})),logs);throw error; }
    return page;
  }
  const a = await client(1), b = await client(2);
  assert.equal(await a.evaluate(() => voice.enabled), false);
  await Promise.all([a.click('#mic'), b.click('#mic')]);
  await Promise.all([ready(a, 1), ready(b, 1)]);
  await Promise.all([audioReceived(a, 1), audioReceived(b, 1)]);
  await Promise.all([a.click('#unlock'),b.click('#unlock')]);
  for (const page of [a,b]) {
    await page.waitForFunction(()=>[...voice.peers.values()].every(p=>p.audio && !p.audio.paused && p.audio.readyState>=2));
    const before=await page.evaluate(()=>[...voice.peers.values()].map(p=>p.audio.currentTime));
    await delay(300);
    const after=await page.evaluate(()=>[...voice.peers.values()].map(p=>p.audio.currentTime));
    assert.ok(after.every((t,i)=>t>before[i]),'Incoming audio player did not advance');
  }
  const pairs=[];
  for (const page of [a,b]) pairs.push(await page.evaluate(async()=>{
    const pc=[...network.peers.values()][0].pc;
    const stats=await pc.getStats();
    const pair=[...stats.values()].find(s=>s.type==='candidate-pair'&&s.state==='succeeded'&&s.nominated);
    return {local:stats.get(pair?.localCandidateId)?.candidateType,remote:stats.get(pair?.remoteCandidateId)?.candidateType};
  }));
  assert.ok(pairs.every(p=>p.local==='relay'&&p.remote==='relay'),'Audio must use the C++ TURN relay');
  console.log('PASS: audio players advancing; selected candidates:',pairs);
  const c = await client(3);
  await c.click('#mic');
  await Promise.all([ready(a, 2), ready(b, 2), ready(c, 2)]);
  await audioReceived(c, 2); // Joins while both existing microphones are already active.
  await Promise.all([audioReceived(a, 2), audioReceived(b, 2)]);
  console.log('Audio received:', await a.evaluate(() => receivedAudio()));
  await a.evaluate(() => { window.oldTrack=voice.stream.getAudioTracks()[0]; voice.stop(); });
  await a.waitForFunction(() => oldTrack.readyState === 'ended' && [...voice.peers.values()].every(p => p.sender.track === null));
  const aId = await a.evaluate(() => network.id);
  const beforeResume = await b.evaluate(async id => (await receivedAudio()).find(s=>s.id===id).energy, aId);
  await a.click('#mic');
  await a.waitForFunction(() => voice.enabled && [...voice.peers.values()].every(p => p.sender.track?.readyState === 'live'));
  let resumed = false;
  for(let i=0;i<125&&!resumed;i++){ resumed=await b.evaluate(async ({id,before})=>(await receivedAudio()).find(s=>s.id===id).energy>before+0.0001,{id:aId,before:beforeResume});if(!resumed)await delay(200); }
  assert.equal(resumed,true,'Resumed microphone did not deliver audio');
  await a.evaluate(() => voice.togglePlayback());
  assert.equal(await a.evaluate(() => [...voice.peers.values()].every(p => p.audio.muted)), true);
  await a.evaluate(() => voice.togglePlayback());
  assert.equal(await a.evaluate(() => [...voice.peers.values()].every(p => !p.audio.muted)), true);
  await b.evaluate(() => { window.oldTrack=voice.stream.getAudioTracks()[0]; network.socket.close(); });
  await b.waitForFunction(() => !voice.online && !voice.enabled && oldTrack.readyState === 'ended' && !document.querySelector('audio'));
  await a.waitForFunction(() => network.peers.size === 1 && voice.peers.size === 1);
  await b.evaluate(() => network.connect());
  await Promise.all([ready(a, 2), ready(b, 2)]);
  assert.equal(await b.evaluate(() => voice.enabled), false);
  await audioReceived(b, 2);
  await b.click('#mic');
  try { await audioReceived(a, 2); } catch (error) {
    console.error('Reconnect sender:', await b.evaluate(async () => ({
      enabled:voice.enabled,pending:voice.pending,error:voice.error,
      track:voice.stream?.getAudioTracks().map(t=>({state:t.readyState,muted:t.muted,enabled:t.enabled})),
      peers:await Promise.all([...network.peers].map(async([id,p])=>({id,state:p.pc.signalingState,
        transceivers:p.pc.getTransceivers().map(t=>({mid:t.mid,direction:t.currentDirection,track:t.sender.track?.readyState})),
        outbound:[...(await p.pc.getStats()).values()].filter(s=>s.type==='outbound-rtp').map(s=>({kind:s.kind,packets:s.packetsSent,bytes:s.bytesSent}))})))
    })));
    throw error;
  }
  // Permission denial leaves the game connection usable.
  await c.evaluate(async () => {
    voice.stop(); window.realGetUserMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('Denied','NotAllowedError'));
    await voice.toggle();
  });
  assert.match(await c.evaluate(() => voice.error), /запрещён/);
  await ready(c, 2);
  // A permission result arriving after logout must never leave a live microphone.
  await c.evaluate(async () => {
    window.lateStream=await realGetUserMedia({audio:true});
    navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>window.resolveMicrophone=resolve);
    window.pendingToggle=voice.toggle(); network.disconnect(); resolveMicrophone(lateStream); await pendingToggle;
  });
  assert.equal(await c.evaluate(() => !voice.enabled && lateStream.getTracks().every(t=>t.readyState==='ended')), true);
  await a.evaluate(async () => {
    window.logoutTrack=voice.stream.getAudioTracks()[0];
    await fetch('/api/auth/logout',{method:'POST',headers:{Authorization:`Bearer ${network.auth.token}`}});
  });
  await a.waitForFunction(() => !network.id && !voice.enabled && logoutTrack.readyState === 'ended');
  await b.evaluate(() => network.disconnect());
  const ui = process.env.VOICE_WEBKIT ? await b.context().newPage() : await browser.newPage({viewport:{width:1440,height:1000}});
  ui.on('pageerror', error => errors.push(error.message));
  await ui.goto(origin);
  await ui.waitForFunction(() => window.planetApp, null, {timeout:45000});
  assert.equal(await ui.locator('#microphone').isDisabled(), true);
  await ui.evaluate(async () => {
    const response=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'voice-ui@example.com',password:'voice-ui-password'})});
    localStorage.setItem('microplanet.auth.v1',JSON.stringify(await response.json()));
  });
  await ui.reload();
  await ui.waitForFunction(() => window.planetApp?.network.id, null, {timeout:45000});
  await ui.click('#microphone');
  await ui.waitForFunction(() => planetApp.voice.enabled);
  assert.equal(await ui.locator('#microphone').getAttribute('aria-pressed'), 'true');
  await ui.waitForFunction(() => planetApp.fish.sequence>=0 && document.getElementById('connection').textContent.includes('В сети'));
  await ui.waitForTimeout(200); // Let the button's color transition finish before visual QA.
  if (process.env.VOICE_SCREENSHOT) await ui.screenshot({path:process.env.VOICE_SCREENSHOT});
  await ui.click('#microphone');
  await ui.waitForFunction(() => !planetApp.voice.enabled);
  assert.equal(await ui.locator('#fatal').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log('PASS: three browsers, bidirectional audio energy, late join, mic off/on, deafen, disconnect, reconnect, denied/late permission, logout revocation, world/data channels, full application microphone UI');
} finally {
  await Promise.all(extraBrowsers.map(browser=>browser.close()));
  await browser?.close();
  if (server.exitCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); }
  await rm(webRoot,{recursive:true,force:true});
}
