import { Terrain } from '../shared/world.js';
import { PlanetScene, vec, orientation } from './scene.js';
import { LakeProfessors } from './lake-professors.js';
import { ProfessorRecorder } from './professor-recorder.js';
import { VoiceChat } from './voice.js';
const B = window.BABYLON, output = document.getElementById('results'), button = document.getElementById('run');
const check = (ok,message) => { if(!ok) throw Error(message); output.textContent += '\nPASS · '+message; };
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
const settle = async recorder => { for(let i=0;i<100&&recorder.tracks.size;i++) await delay(30); check(!recorder.tracks.size,'Все дорожки завершены'); };
try {
  const engine = new B.Engine(document.getElementById('canvas'),true), scene = new B.Scene(engine); scene.useRightHandedSystem=true;
  const data=await fetch('/assets/world.json').then(r=>r.json()), terrain=new Terrain(data), planet=new PlanetScene(scene,data);
  const recorder=new ProfessorRecorder(), professors=new LakeProfessors(scene,terrain,planet,recorder);
  const voice=new VoiceChat(()=>{void recorder.setVoiceStream(voice.stream);}); voice.localAllowed=true;
  const camera=new B.FreeCamera('speech-test-camera',vec(terrain.spawn()),scene); scene.activeCamera=camera; camera.minZ=.05;
  check(await professors.ready,'Модели и 3D-панели загружены');
  const guide=professors.guides[0], up=vec(guide.up), forward=vec(guide.forward);
  camera.position.copyFrom(guide.root.position.add(forward.scale(5.8)).add(up.scale(2.8)));
  const direction=guide.root.position.add(up.scale(2)).subtract(camera.position).normalize();
  const right=B.Vector3.Cross(direction,up).normalize(), cameraUp=B.Vector3.Cross(right,direction).normalize();
  camera.rotationQuaternion=orientation(direction,cameraUp); camera.updateUpVectorFromRotation=true;
  const player={position:guide.root.position.add(forward.scale(4))};
  professors.update(1,player,camera);
  check(recorder.target===0,'Приближение выбирает только ближайшее озеро');
  check(!recorder.enabled&&!recorder.pending,'Без микрофона голосового чата записи нет');
  check(professors.guides.every(g=>!g.sign.isPickable)&&!professors.targetAt,'На панелях нет отдельной кнопки записи');
  let trackPlayer=true;
  engine.runRenderLoop(()=>{ if(trackPlayer) professors.update(.016,player,camera); else professors.guides.forEach(g=>professors.draw(g)); planet.update(.016,camera); scene.render(); });
  button.disabled=false;
  button.onclick=async()=>{
    button.disabled=true; trackPlayer=false;
    const originalCapture=navigator.mediaDevices.getUserMedia, originalFetch=window.fetch;
    let synthetic, source, calls=0, healthMode='ok', resumeHealth;
    const sent=[], streams=[];
    try {
      synthetic=new AudioContext(); await synthetic.resume();
      source=synthetic.createConstantSource(); source.offset.value=.2; source.start();
      const makeStream=()=>{const destination=synthetic.createMediaStreamDestination(); source.connect(destination); streams.push(destination.stream); return destination.stream;};
      navigator.mediaDevices.getUserMedia=async()=>{calls++; return makeStream();};
      window.fetch=async(url,options)=>{
        if(url==='/api/professors/health') {
          if(healthMode==='pending') return new Promise(resolve=>{resumeHealth=resolve;});
          return new Response('{"ready":true}',{status:healthMode==='ok'?200:503});
        }
        if(url==='/api/professors/transcribe') {
          const data=new DataView(options.body); let sum=0;
          for(let i=44;i<data.byteLength;i+=2) sum+=data.getInt16(i,true)/32768;
          const mean=sum/((data.byteLength-44)/2); sent.push(mean); await delay(100);
          return new Response(JSON.stringify({words:[{word:mean<.3?'Первое озеро.':'Второе озеро.',start:0,end:.2}]}),{status:200});
        }
        return originalFetch(url,options);
      };
      await voice.toggle(); await recorder.connection;
      const shared=voice.stream, ended=shared.getAudioTracks()[0].onended;
      check(voice.enabled&&recorder.enabled&&recorder.stream===shared&&calls===1,'Один запрос микрофона: профессор использует тот же поток VoiceChat');
      await delay(650); recorder.setTarget(null); await delay(200);
      source.offset.value=.4; recorder.setTarget(1); await delay(650);
      await recorder.stop(); await settle(recorder);
      check(voice.enabled&&shared.getTracks().every(t=>t.readyState==='live')&&shared.getAudioTracks()[0].onended===ended,'Остановка расшифровки не выключает чат и не меняет его обработчики');
      check(sent.length===2&&Math.abs(sent[0]-.2)<.03&&Math.abs(sent[1]-.4)<.03,'Хвосты worklet остаются в своей дорожке; вне зоны запросов нет');
      check(recorder.record(0).text==='Первое озеро.'&&recorder.record(1).text==='Второе озеро.','Текст изолирован по озёрам');
      healthMode='error'; voice.onChange(); await recorder.connection;
      check(voice.enabled&&!recorder.enabled&&!!recorder.error&&calls===1,'Ошибка Whisper не отключает голосовой чат и не запрашивает второй микрофон');
      await voice.toggle(); await recorder.connection;
      check(!voice.enabled&&!recorder.enabled&&shared.getTracks().every(t=>t.readyState==='ended'),'Выключение общего микрофона завершает расшифровку');
      healthMode='ok'; recorder.setTarget(0);
      navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('denied','NotAllowedError');};
      await voice.toggle(); check(!voice.enabled&&!recorder.enabled&&voice.error.includes('запрещён'),'Отказ разрешения голосового чата не запускает запись');
      navigator.mediaDevices.getUserMedia=async()=>{calls++; return makeStream();};
      await voice.toggle(); await recorder.connection; await delay(300);
      const beforeMute=sent.length; await voice.toggle(); await recorder.connection; await settle(recorder);
      check(sent.length===beforeMute+1&&!recorder.enabled,'Выключение чата отправляет последний короткий фрагмент');
      healthMode='pending';
      await voice.toggle(); for(let i=0;i<100&&!resumeHealth;i++)await delay(20);
      check(!!resumeHealth,'Подключение Whisper ожидается');
      recorder.clear(); resumeHealth(new Response('{"ready":true}',{status:200})); await recorder.connection;
      check(!recorder.enabled&&recorder.records.size===0&&voice.enabled&&voice.stream.getTracks().every(t=>t.readyState==='live'),'Поздний ответ Whisper после очистки не запускает запись и не останавливает чат');
      voice.stop(); await recorder.connection;
      recorder.error=''; recorder.record(0).text='Первое озеро. Профессор автоматически слушает включённый голосовой чат.';
      recorder.record(1).text='Второе озеро.'; recorder.setTarget(0); professors.update(.016,player,camera);
      check(guide.state.includes('Первое озеро')&&!guide.state.includes('Второе озеро'),'Результат нарисован на 3D-панели своего профессора');
      output.textContent+='\nВсе браузерные проверки расшифровки пройдены.';
    } catch(error) { output.textContent+='\nFAIL · '+error.message; console.error(error); }
    finally {
      navigator.mediaDevices.getUserMedia=originalCapture; window.fetch=originalFetch;
      voice.stop(); await recorder.stop(false); source?.stop(); streams.forEach(s=>s.getTracks().forEach(t=>t.stop())); await synthetic?.close();
    }
  };
} catch(error) {output.textContent+='\nFAIL · '+error.message; console.error(error);}
