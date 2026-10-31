import {Terrain,WATER_RADIUS,clamp} from '../shared/world.js';
import {PlanetScene,FishView} from './scene.js';
import {Player} from './player.js';
import {Network} from './network.js';
import {NatureAudio} from './audio.js';
import {VoiceChat} from './voice.js';
import {XRView} from './xr.js';
import {Auth} from './auth.js';
import {AuthPanel} from './auth-panel.js';
import {VisualQuality} from './quality.js';
import {setupFullscreen} from './fullscreen.js';
const $=id=>document.getElementById(id);
async function start(){
 setupFullscreen($('fullscreen'),$('display-status'));
 const auth=new Auth();
 const B=window.BABYLON;if(!B)throw Error('Не удалось загрузить Babylon.js. Перезапустите сервер и обновите страницу.');
 // VisualQuality owns display scaling; avoid applying devicePixelRatio twice on resize.
 const engine=new B.Engine($('world'),true,{preserveDrawingBuffer:false,stencil:true},false);
 const scene=new B.Scene(engine);scene.useRightHandedSystem=true;
 const response=await fetch('/assets/world.json');if(!response.ok)throw Error('Данные мира недоступны');const data=await response.json();
 const terrain=new Terrain(data),planet=new PlanetScene(scene,data),player=new Player(scene,terrain,planet,$('world')),fish=new FishView(scene,data.fishProfiles),sound=new NatureAudio(terrain);
 const quality=new VisualQuality(engine,scene,player,$('quality'));
 let network,xr,authPanel,signingIn=false,loggingOut=false;
 async function signIn(message=''){
   document.exitPointerLock();
   const ready=auth.require(message);
   if(authPanel)authPanel.recenter=true;
   if(signingIn)return;signingIn=true;
   await ready;signingIn=false;network.connect();
 }
 const voice=new VoiceChat(()=>{
   $('microphone').disabled=!voice.online;
   $('microphone').textContent=voice.pending?'Отменить запрос микрофона':`N · Микрофон ${voice.enabled?'вкл':'выкл'}`;
   $('microphone').setAttribute('aria-pressed',String(voice.enabled));
   $('voice-playback').textContent=voice.muted?'Слышать участников':'Заглушить участников';
   $('voice-playback').setAttribute('aria-pressed',String(voice.muted));
   $('voice-status').textContent=voice.status;
   $('voice-unlock').hidden=!voice.playbackBlocked;
 });
 voice.onChange();
 $('microphone').onclick=()=>void voice.toggle();
 $('voice-playback').onclick=()=>voice.togglePlayback();
 $('voice-unlock').onclick=()=>voice.unlock();
 network=new Network(scene,player,fish,planet,auth,()=>{void signIn('Сессия завершена. Прогулка продолжается локально.');},voice);
 window.addEventListener('pagehide',()=>network.disconnect());
 $('login').onclick=()=>{void signIn();};
 $('logout').onclick=async()=>{
   if(loggingOut)return;loggingOut=true;network.disconnect();
   const message=await auth.logout();loggingOut=false;void signIn(message);
 };
 let fps=0;
 function info(){const depth=Math.max(0,WATER_RADIUS-player.position.length());return `MICRO / PLANET\n${Math.round(fps)} FPS · ${scene.getActiveMeshes().length} meshes\n${network.status} · ID ${network.id||'—'}\nИгроки ${network.peers.size+1} / 8 · RTT ${network.ping??'—'} мс\nWebRTC RX ${network.rx}\nРыбы · ${network.worldTransport} · tick ${fish.sequence}\n${depth>.05?'Глубина '+depth.toFixed(1)+' м':'На суше'}\nЗвук ${sound.muted?'выключен':'включён'}\nГолос · ${voice.enabled?'микрофон вкл':'микрофон выкл'} · X${[...network.remotes].slice(0,3).map(([id,r])=>'\n#'+id+' · '+(Math.acos(clamp(B.Vector3.Dot(player.position.normalizeToNew(),r.node.position.normalizeToNew()),-1,1))*38).toFixed(1)+' м').join('')}`;}
 xr=new XRView(scene,player,planet,$('vr'),info);
 xr.toggleMicrophone=()=>void voice.toggle();
 $('vr-quality').onclick=()=>{xr.highQuality=!xr.highQuality;$('vr-quality').textContent=xr.highQuality?'VR · детально':'VR · плавно';$('vr-quality').setAttribute('aria-pressed',String(xr.highQuality));};
 if(!auth.token)void signIn();
 $('explore').disabled=false;$('explore').textContent='Начать исследование ↗';
 const unlock=()=>{voice.unlock();sound.start().catch(()=>{});};
 const explore=()=>{document.activeElement?.blur();if(player.overview)player.toggleOverview();unlock();if(!xr.active)$('world').requestPointerLock()?.catch(()=>{});};
 authPanel=new AuthPanel(scene,auth,player,$('world'),explore);xr.authPanel=authPanel;
 $('explore').onclick=explore;$('auth-walk').onclick=explore;$('world').addEventListener('click',unlock);
 document.addEventListener('pointerlockchange',()=>{
   if(document.pointerLockElement===$('world'))$('auth-dialog').close();
   else if(!auth.token&&!xr.active){auth.require();authPanel.recenter=true;}
 });
 $('reconnect').onclick=()=>network.connect();$('overview').onclick=()=>{if(!xr.active)player.toggleOverview();};$('view').onclick=()=>{if(!xr.active&&!player.overview)player.third=!player.third;};
 const mute=()=>{sound.toggle();$('sound').textContent='M · Звук '+(sound.muted?'выключен':'включён');};$('sound').onclick=mute;
 window.addEventListener('keydown',e=>{if(player.inputEnabled&&!e.target.closest?.('input,textarea,select,button,[contenteditable]')&&e.code==='KeyM'&&!e.repeat)mute();});
 window.addEventListener('keydown',e=>{if(player.inputEnabled&&!e.target.closest?.('input,textarea,select,button,[contenteditable]')&&e.code==='KeyN'&&!e.repeat)void voice.toggle();});
 window.addEventListener('resize',()=>engine.resize());
 let previous=performance.now(),hudAt=0;
 engine.runRenderLoop(()=>{
   const now=performance.now(),dt=Math.min((now-previous)/1000,.05);previous=now;
   player.update(dt,xr.input());xr.sync();network.update(dt);fish.update(dt);planet.updateActor('local',player.position,dt);authPanel.sync();
   const camera=scene.activeCamera;camera.computeWorldMatrix();planet.update(dt,camera);
   const underwater=!player.overview&&camera.globalPosition.length()<WATER_RADIUS;sound.update(player,underwater);
   $('underwater').style.display=underwater?'block':'none';document.body.classList.toggle('playing',document.pointerLockElement===$('world')&&!player.overview);document.body.classList.toggle('overview',player.overview);
   if(now>hudAt){hudAt=now+250;fps=engine.getFps();$('connection').textContent=network.status+(network.id?' · #'+network.id:'');
     $('stats').textContent=!auth.token?`${Math.round(fps)} FPS · только вы\nСинхронизация выключена\nВойдите, чтобы встретить других игроков`:`${Math.round(fps)} FPS · ${network.peers.size+1} / 8 игроков\nPing (RTT) · ${now-network.pingAt<5000?network.ping??'—':'—'} мс\nWebRTC RX · ${network.rx}\nРыбы · ${network.worldTransport}${fish.sequence>=0?' · 48':' · ожидание'}\n${fish.sequence>=0?'Снимок '+fish.sequence:''}`;
     $('reconnect').textContent=auth.token?'Переподключиться ↗':'Войти в общий мир ↗';
     $('players').textContent=[...network.remotes].map(([id,r])=>{const dot=B.Vector3.Dot(player.position.normalizeToNew(),r.node.position.normalizeToNew()),angle=Math.acos(clamp(dot,-1,1)),distance=angle*38,peer=network.peers.get(id),notes=[];
       if(angle>.32)notes.push('за горизонтом');if(r.node.position.length()<WATER_RADIUS)notes.push('в воде');if(B.Vector3.Dot(r.node.position.subtract(player.position),player.forward)<0)notes.push('сзади');if(now-r.last>3000)notes.push('нет свежей позиции');
       return `#${id} · ${distance.toFixed(1)} м · ${now-peer?.pingAt<5000?peer?.ping??'—':'—'} мс${notes.length?'\n'+notes.join(' · '):''}`;
     }).concat([...network.peers.keys()].filter(id=>!network.remotes.has(id)).map(id=>'#'+id+' · ожидание позиции')).join('\n');
     const depth=Math.max(0,WATER_RADIUS-player.position.length());$('location').textContent=player.overview?'Вся планета · Tab — вернуться':depth>.05?`${underwater?'Под водой':'В воде'} · глубина ${depth.toFixed(1)} м`:`${player.third?'Третье лицо':'Первое лицо'} · озеро впереди`;
   }
   scene.render();
 });
 // Deliberate read-only diagnostics for local smoke tests and troubleshooting.
 window.planetApp={engine,scene,terrain,planet,player,fish,network,xr,sound,voice,authPanel,quality};
}
start().catch(error=>{console.error(error);$('fatal').hidden=false;$('fatal').textContent='Не удалось запустить мир\n'+error.message;$('welcome').hidden=true;});
