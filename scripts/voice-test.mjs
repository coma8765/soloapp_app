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
const lanAddress = process.env.VOICE_LAN_ADDRESS;
const host = lanAddress || '127.0.0.1';
const tlsCert = process.env.VOICE_TLS_CERT || '';
const tlsKey = process.env.VOICE_TLS_KEY || '';
assert.equal(!!tlsCert, !!tlsKey, 'Supply both VOICE_TLS_CERT and VOICE_TLS_KEY');
assert.ok(!lanAddress || tlsCert, 'The LAN microphone test requires HTTPS');
const listener = net.createServer().listen(0, host);
await once(listener, 'listening');
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const origin = `${tlsCert ? 'https' : 'http'}://${host}:${port}`;
const webRoot = await mkdtemp(join(tmpdir(),'planet-voice-'));
for (const name of ['index.html','client','shared','assets','vendor']) await symlink(`${root}/public/${name}`,`${webRoot}/${name}`);
const server = spawn(`${root}/build/planet_server`, [`--host=${host}`, `--port=${port}`, '--auth-db=:memory:', `--web=${webRoot}`], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PLANET_RTC_CONFIG: '',
    PLANET_TURN_ADDRESS: host, PLANET_TURN_PORT: '0', PLANET_TLS_CERT: tlsCert, PLANET_TLS_KEY: tlsKey }
});
let logs = '';
server.stdout.on('data', data => { logs += data; });
server.stderr.on('data', data => { logs += data; });
let browser, roomId = 0;
const extraBrowsers = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready(page, count) {
  try { await page.waitForFunction(n => network.id && network.peers.size === n &&
    [...network.peers.values()].every(p => p.pc.connectionState === 'connected' && p.dc?.readyState === 'open') &&
    network.worldTick >= 0, count, { timeout: 25000 }); } catch(error) { console.error('Readiness:',await page.evaluate(()=>({id:network.id,status:network.status,world:network.worldPC?.connectionState,tick:network.worldTick,peers:[...network.peers].map(([id,p])=>({id,connection:p.pc.connectionState,ice:p.pc.iceConnectionState,signal:p.pc.signalingState,dc:p.dc?.readyState,transceivers:p.pc.getTransceivers().map(t=>({mid:t.mid,direction:t.currentDirection}))}))}))); throw error; }
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
async function positionsReceived(pages) {
  const expected = await Promise.all(pages.map(page => page.evaluate(() => ({id:network.id,position:player.position.asArray()}))));
  await Promise.all(pages.map(page => page.waitForFunction(rows => rows.every(row =>
    row.id === network.id || JSON.stringify(network.remotes.get(row.id)?.target.asArray()) === JSON.stringify(row.position)
  ), expected)));
}
async function avatarsReceived(pages) {
  const expected=await Promise.all(pages.map(page=>page.evaluate(()=>({id:network.id,avatarId:player.avatar.id}))));
  await Promise.all(pages.map(page=>page.waitForFunction(rows=>rows.every(row=>{
    if(row.id===network.id)return true;
    const avatar=network.remotes.get(row.id)?.avatar;
    return avatar?.id===row.avatarId&&avatar.root.isEnabled()&&!avatar.fallback.isEnabled()&&
      avatar.label.isEnabled()&&avatar.container.meshes.some(mesh=>mesh.getTotalVertices()>0&&mesh.isEnabled());
  }),expected,{timeout:45000})));
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
    await writeFile(`${webRoot}/voice-test-${index}.html`, `<!doctype html><button id="mic">Mic</button><button id="unlock">Play voices</button><canvas id="view" width="800" height="600"></canvas><script src="/vendor/babylon.js"></script><script src="/vendor/babylonjs.loaders.min.js"></script><script type="module">
      import {Network} from '/client/network.js';
      import {VoiceChat} from '/client/voice.js';
      import {Player} from '/client/player.js';
      window.VoiceChat=VoiceChat;
      window.voice=new VoiceChat();
      const response=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'voice${index}@example.com',password:'voice-test-password'})});
      const account=await response.json();
      const auth={token:account.token,expiresAt:account.expires_at*1000,clear(){this.token=null;}};
      window.player={worldMap:'white-room',position:new BABYLON.Vector3(${index},0,0),rotation:BABYLON.Quaternion.Identity(),pitch:.25,speed:3,inputEnabled:true,avatar:{id:['male','female','uraraka'][${index}-1]},state:Player.prototype.state};
      const engine=new BABYLON.Engine(document.getElementById('view'),true);
      const scene=new BABYLON.Scene(engine);scene.useRightHandedSystem=true;
      const camera=new BABYLON.FreeCamera('test-camera',new BABYLON.Vector3(0,2,-13),scene);camera.setTarget(new BABYLON.Vector3(0,1,0));
      new BABYLON.HemisphericLight('test-light',new BABYLON.Vector3(0,1,0),scene);
      engine.runRenderLoop(()=>scene.render());
      const planet={actors:new Map(),updateActor(id,position){this.actors.set(id,position.asArray());}};
      const fish={last:0,sequence:-1,reset(){this.last=0;this.sequence=-1;},snapshot(s){this.last=performance.now();this.sequence=s.sequence;}};
      window.network=new Network(scene,player,fish,planet,auth,()=>{},voice);
      document.getElementById('mic').onclick=()=>voice.toggle();
      document.getElementById('unlock').onclick=()=>voice.unlock();
      setInterval(()=>network.update(.05),50);
      window.receivedAudio=async()=>{const rows=[];for(const [id,p] of network.peers)for(const s of (await p.pc.getStats()).values())if(s.type==='inbound-rtp'&&s.kind==='audio')rows.push({id,packets:s.packetsReceived,energy:s.totalAudioEnergy});return rows;};
      </script>`);
    // The small scene renders the real remote GLBs and animation; world assets
    // are exercised separately on the full application page below.
    await page.goto(`${origin}/voice-test-${index}.html`);
    try { await page.waitForFunction(() => !!window.network); } catch(error) { console.error('Client state:',await page.evaluate(()=>({network:!!window.network,status:window.network?.status,error:window.voice?.error})),logs);throw error; }
    roomId = await page.evaluate(async id => {
      const response = await fetch('/api/servers' + (id ? '/' + id + '/join' : ''), {
        method:'POST', headers:{Authorization:'Bearer ' + network.auth.token}
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      return data.server.id;
    }, roomId);
    return page;
  }
  const a = await client(1), b = await client(2), c = await client(3);
  await a.evaluate(async id => {
    const r = await fetch('/api/servers/' + id + '/start', {method:'POST',headers:{Authorization:'Bearer ' + network.auth.token}});
    if (!r.ok) throw Error('Cannot start voice test room');
  }, roomId);
  for (const page of [a,b,c]) await page.evaluate(async id => {
    const r = await fetch('/api/servers/' + id + '/ready', {method:'POST',headers:{Authorization:'Bearer ' + network.auth.token}});
    if (!r.ok) throw Error('Cannot prepare voice test room');
  }, roomId);
  let running=false;
  for(let attempt=0;attempt<100&&!running;attempt++){
    const state=await a.evaluate(async id=>{
      const r=await fetch('/api/servers/'+id,{headers:{Authorization:'Bearer '+network.auth.token},cache:'no-store'});
      if(!r.ok)throw Error('Cannot read voice test room');
      return (await r.json()).server?.state;
    },roomId);
    running=state==='running';
    if(!running)await delay(100);
  }
  assert.ok(running,'Room countdown did not finish');
  await Promise.all([a,b].map(page=>page.evaluate(id=>network.connect(id),roomId)));
  await Promise.all([ready(a,1),ready(b,1)]);
  assert.equal(await a.evaluate(() => voice.enabled), false);
  await Promise.all([a.click('#mic'), b.click('#mic')]);
  await Promise.all([ready(a, 1), ready(b, 1)]);
  await positionsReceived([a,b]);
  await avatarsReceived([a,b]);
  await a.evaluate(()=>{player.position.x=7;});
  await b.evaluate(()=>{player.position.x=-8;});
  await positionsReceived([a,b]);
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
    const transport=[...stats.values()].find(s=>s.type==='transport'&&s.selectedCandidatePairId);
    const pair=stats.get(transport?.selectedCandidatePairId)||[...stats.values()].find(s=>s.type==='candidate-pair'&&s.state==='succeeded'&&s.nominated);
    const local=stats.get(pair?.localCandidateId),remote=stats.get(pair?.remoteCandidateId);
    return {local:local?.candidateType,remote:remote?.candidateType,localAddress:local?.address,remoteAddress:remote?.address,localPort:local?.port,remotePort:remote?.port};
  }));
  console.log('Selected candidates:',pairs);
  // A remote relay may appear as prflx when discovered by connectivity checks.
  // Verify both local allocations and that the two selected endpoints match.
  assert.ok(pairs.every(p=>p.local==='relay'),'Both browsers must send through the C++ TURN relay');
  assert.ok(pairs.every(p=>p.localAddress===host&&p.remoteAddress===host),'Selected relay must use the configured interface address');
  assert.ok(pairs[0].localPort===pairs[1].remotePort&&pairs[1].localPort===pairs[0].remotePort,'Selected relay endpoints must match across browsers');
  console.log('PASS: audio players advancing and player positions received through configured TURN');
  await c.evaluate(id=>network.connect(id),roomId);
  await ready(c,2);
  await c.click('#mic');
  await Promise.all([ready(a, 2), ready(b, 2), ready(c, 2)]);
  await positionsReceived([a,b,c]);
  await avatarsReceived([a,b,c]);
  const bId=await b.evaluate(()=>network.id);
  const animatedBefore=await a.evaluate(id=>network.remotes.get(id).avatar.joints.get('thigh_l').node.rotationQuaternion.asArray(),bId);
  await delay(250);
  const animatedAfter=await a.evaluate(id=>network.remotes.get(id).avatar.joints.get('thigh_l').node.rotationQuaternion.asArray(),bId);
  assert.notDeepEqual(animatedAfter,animatedBefore,'Remote walking animation did not advance');
  await b.evaluate(()=>{player.speed=0;});
  await a.waitForFunction(id=>network.remotes.get(id).avatar.stride<.001,bId);
  // Appearance must arrive even if the unreliable movement channel loses it.
  await a.evaluate(()=>{
    for(const peer of network.peers.values())peer.dc.send=()=>{};
    player.avatar.id='uraraka';
  });
  await avatarsReceived([a,b,c]);
  await a.evaluate(()=>{for(const peer of network.peers.values())delete peer.dc.send;player.avatar.id='female';});
  await avatarsReceived([a,b,c]);
  await a.evaluate(()=>{player.position.x=-2;});
  await c.evaluate(()=>{player.position.x=2;});
  await positionsReceived([a,b,c]);
  await b.evaluate(async()=>{
    for(const remote of network.remotes.values())for(const mesh of remote.avatar.container.meshes)
      if(mesh.getTotalVertices()>0)await mesh.material?.forceCompilationAsync(mesh);
  });
  await b.waitForFunction(()=>[...network.remotes.values()].every(r=>r.avatar.container.meshes.some(m=>
    m.getTotalVertices()>0&&m.isEnabled()&&m.isVisible&&m.getScene().activeCamera.isInFrustum(m))));
  await delay(250);
  if(process.env.AVATAR_SCREENSHOT)await b.locator('#view').screenshot({path:process.env.AVATAR_SCREENSHOT});
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
  await b.evaluate(() => { window.oldTrack=voice.stream.getAudioTracks()[0]; window.oldAvatars=[...network.remotes.values()].map(r=>r.avatar); network.socket.close(); });
  await b.waitForFunction(() => !voice.online && !voice.enabled && oldTrack.readyState === 'ended' && !document.querySelector('audio'));
  assert.equal(await b.evaluate(()=>oldAvatars.every(a=>a.root.isDisposed()&&a.container.meshes.every(m=>m.isDisposed()))),true,'Remote models leaked after disconnect');
  await a.waitForFunction(() => network.peers.size === 1 && voice.peers.size === 1);
  await b.evaluate(() => network.connect());
  await Promise.all([ready(a, 2), ready(b, 2)]);
  await positionsReceived([a,b,c]);
  await avatarsReceived([a,b,c]);
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
  await Promise.all([a.close(),b.close(),c.close()]);
  const ui = process.env.VOICE_WEBKIT ? await b.context().newPage() : await browser.newPage({viewport:{width:1440,height:1000}});
  ui.on('pageerror', error => errors.push(error.message));
  await ui.goto(origin);
  await ui.waitForFunction(() => window.planetApp, null, {timeout:45000});
  assert.equal(await ui.evaluate(()=>planetApp.voice.enabled),false);
  assert.equal(await ui.locator('#microphone').isDisabled(),false); // Local professor capture is available before login.
  await ui.evaluate(async () => {
    const response=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'voice-ui@example.com',password:'voice-ui-password'})});
    localStorage.setItem('microplanet.auth.v1',JSON.stringify(await response.json()));
  });
  await ui.reload();
  await ui.waitForFunction(() => window.planetApp?.network.id && planetApp.network.worldTick>=0, null, {timeout:45000});
  const visitor=await browser.newPage({viewport:{width:1200,height:900}});
  visitor.on('pageerror',error=>errors.push(error.message));
  await visitor.goto(origin);
  await visitor.waitForFunction(()=>window.planetApp,null,{timeout:45000});
  await visitor.evaluate(async()=>{
    const r=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'planet-visitor@example.com',password:'planet-test-password'})});
    localStorage.setItem('microplanet.auth.v1',JSON.stringify(await r.json()));
  });
  await visitor.reload();
  for(const page of [ui,visitor])await page.waitForFunction(()=>window.planetApp?.network.remotes.size===1&&[...planetApp.network.remotes.values()].every(r=>r.avatar.id&&!r.avatar.fallback.isEnabled()),null,{timeout:45000});
  for(const page of [ui,visitor]){
    assert.equal(await page.evaluate(()=>planetApp.player.worldMap),'planet');
    await page.evaluate(()=>{
      const a=planetApp,p=a.player,remote=[...a.network.remotes.values()][0];
      a.authPanel.closeSettings();a.lobby.visible=false;a.authPanel.sync();
      const delta=remote.target.subtract(p.position),up=p.up();
      p.forward.copyFrom(delta.subtract(up.scale(BABYLON.Vector3.Dot(delta,up))).normalize());p.pitch=0;p.third=true;
    });
    await page.waitForFunction(()=>[...planetApp.network.remotes.values()].every(r=>r.avatar.container.meshes.some(m=>m.getTotalVertices()>0&&m.isEnabled()&&planetApp.scene.activeCamera.isInFrustum(m))));
  }
  const visitorId=await visitor.evaluate(()=>planetApp.network.id);
  const before=await ui.evaluate(id=>planetApp.network.remotes.get(id).target.asArray(),visitorId);
  await visitor.evaluate(()=>{planetApp.player.gamepadMove={x:1,y:0};planetApp.player.update(.2);planetApp.player.gamepadMove=null;});
  await ui.waitForFunction(({id,before})=>BABYLON.Vector3.Distance(planetApp.network.remotes.get(id).target,BABYLON.Vector3.FromArray(before))>.2,{id:visitorId,before});
  if(process.env.PLANET_SCREENSHOT)await ui.screenshot({path:process.env.PLANET_SCREENSHOT});
  console.log('PASS: two full application clients automatically see moving avatars on shared planet');
  await ui.evaluate(async () => {
    planetApp.authPanel.closeSettings();
    await planetApp.lobby.action('');
  });
  const fullRoom=await ui.evaluate(()=>planetApp.lobby.current.id);
  await visitor.evaluate(async id=>{await planetApp.lobby.action('/'+id+'/join');},fullRoom);
  await ui.evaluate(async id=>{await planetApp.lobby.action('/'+id+'/start');},fullRoom);
  try { await ui.waitForFunction(() => window.planetApp?.network.id && planetApp.player.worldMap==='white-room', null, {timeout:45000}); } catch(error) { console.error('UI room:',await ui.evaluate(()=>({current:planetApp.lobby.current,error:planetApp.lobby.error,status:planetApp.network.status,map:planetApp.player.worldMap,fatal:document.getElementById('fatal').textContent})),errors); throw error; }
  for(const page of [ui,visitor])await page.waitForFunction(()=>planetApp.player.worldMap==='white-room'&&planetApp.network.remotes.size===1&&[...planetApp.network.remotes.values()].every(r=>r.avatar.id),null,{timeout:45000});
  await ui.click('#microphone');
  await ui.waitForFunction(() => planetApp.voice.enabled);
  assert.equal(await ui.locator('#microphone').getAttribute('aria-pressed'), 'true');
  await ui.waitForFunction(() => planetApp.network.worldTick>=0 && document.getElementById('connection').textContent.includes('В сети'));
  await ui.waitForTimeout(200); // Let the button's color transition finish before visual QA.
  if (process.env.VOICE_SCREENSHOT) await ui.screenshot({path:process.env.VOICE_SCREENSHOT});
  await ui.click('#microphone');
  await ui.waitForFunction(() => !planetApp.voice.enabled);
  assert.equal(await ui.locator('#fatal').isVisible(), false);
  await ui.evaluate(async id=>{await planetApp.lobby.action('/'+id,'DELETE');},fullRoom);
  for(const page of [ui,visitor])await page.waitForFunction(()=>planetApp.player.worldMap==='planet'&&planetApp.network.remotes.size===1&&planetApp.network.worldTick>=0,null,{timeout:45000});
  await visitor.close();
  console.log('PASS: both visitors transition into private room and return to shared planet');
  assert.deepEqual(errors, []);
  console.log('PASS: three browsers, bidirectional audio energy, player positions and movement, remote GLB avatars, animation, reliable appearance changes, late join, mic off/on, deafen, disconnect, reconnect, denied/late permission, logout revocation, world/data channels, full application microphone UI');
} finally {
  await Promise.all(extraBrowsers.map(browser=>browser.close()));
  await browser?.close();
  if (server.exitCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); }
  await rm(webRoot,{recursive:true,force:true});
}
