import { Terrain } from '../shared/world.js';
import { PlanetScene, vec, orientation } from './scene.js';
import { LakeProfessors } from './lake-professors.js';
import { ProfessorRecorder } from './professor-recorder.js';
import { AccountPanel } from './account-panel.js';
const B = window.BABYLON, output = document.getElementById('results'), button = document.getElementById('run');
const check = (ok,message) => { if(!ok) throw Error(message); output.textContent += '\nPASS · '+message; };
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
const settle = async recorder => { for(let i=0;i<100&&recorder.tracks.size;i++) await delay(30); check(!recorder.tracks.size,'Все дорожки завершены'); };
try {
  const engine = new B.Engine(document.getElementById('canvas'),true), scene = new B.Scene(engine); scene.useRightHandedSystem=true;
  const data=await fetch('/assets/world.json').then(r=>r.json()), terrain=new Terrain(data), planet=new PlanetScene(scene,data);
  const recorder=new ProfessorRecorder(), professors=new LakeProfessors(scene,terrain,planet,recorder);
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
  // Exercise the actual shared mouse/XR picking path with a ray to the button.
  const panel=Object.create(AccountPanel.prototype);
  Object.assign(panel,{mesh:{isEnabled:()=>false},gear:{isEnabled:()=>true},worldPanel:professors,scene});
  const buttonPoint=B.Vector3.TransformCoordinates(new B.Vector3(0,(.5-624/768)*2.1,0),guide.sign.computeWorldMatrix(true));
  const ray=new B.Ray(camera.position,buttonPoint.subtract(camera.position).normalize(),8);
  const pick=scene.pickWithRay(ray,mesh=>panel.isInteractiveMesh(mesh));
  check(panel.targetAt(pick)?.id==='professor-record-0','Общий обработчик 3D-интерфейса находит кнопку лучом');
  let trackPlayer=true;
  engine.runRenderLoop(()=>{ if(trackPlayer) professors.update(.016,player,camera); else professors.guides.forEach(g=>professors.draw(g)); planet.update(.016,camera); scene.render(); });
  button.disabled=false;
  button.onclick=async()=>{
    button.disabled=true; trackPlayer=false;
    const originalCapture=navigator.mediaDevices.getUserMedia, originalFetch=window.fetch;
    let synthetic, source, stream, calls=0;
    const sent=[];
    try {
      synthetic=new AudioContext(); await synthetic.resume();
      const destination=synthetic.createMediaStreamDestination();
      source=synthetic.createConstantSource(); source.offset.value=.2; source.connect(destination); source.start(); stream=destination.stream;
      navigator.mediaDevices.getUserMedia=async()=>{calls++; return stream;};
      window.fetch=async(url,options)=>{
        if(url==='/api/professors/health') return new Response('{"ready":true}',{status:200});
        if(url==='/api/professors/transcribe') {
          const data=new DataView(options.body); let sum=0;
          for(let i=44;i<data.byteLength;i+=2) sum+=data.getInt16(i,true)/32768;
          const mean=sum/((data.byteLength-44)/2); sent.push(mean);
          await delay(100); // Lake 1 finishes asynchronously while lake 2 captures.
          return new Response(JSON.stringify({words:[{word:mean<.3?'Первое озеро.':'Второе озеро.',start:0,end:.2}]}),{status:200});
        }
        return originalFetch(url,options);
      };
      await recorder.toggle(); check(recorder.enabled&&!recorder.error,'Запущен настоящий AudioWorklet на синтетическом MediaStream');
      await delay(650); recorder.setTarget(null); await delay(200);
      source.offset.value=.4; recorder.setTarget(1); await delay(650);
      await recorder.stop(); await settle(recorder);
      check(sent.length===2&&Math.abs(sent[0]-.2)<.03&&Math.abs(sent[1]-.4)<.03,'Хвосты worklet остаются в своей дорожке; вне зоны запросов нет');
      check(recorder.record(0).text==='Первое озеро.'&&recorder.record(1).text==='Второе озеро.','Текст изолирован по озёрам');
      check(stream.getTracks().every(t=>t.readyState==='ended')&&!recorder.enabled,'Остановка освобождает микрофон');
      recorder.setTarget(null); const previous=calls; await recorder.toggle(); check(calls===previous,'Нельзя включить запись вдали от профессора');
      recorder.setTarget(0); navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('denied','NotAllowedError');};
      await recorder.toggle(); check(!recorder.enabled&&!recorder.pending&&recorder.error.includes('запрещён'),'Отказ разрешения показан без зависшего захвата');
      let allow;
      navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>{allow=resolve;});
      const pending=recorder.toggle(); for(let i=0;i<100&&!allow;i++)await delay(20);
      check(!!allow,'Запрос разрешения ожидается');
      recorder.clear();
      const late=synthetic.createMediaStreamDestination().stream;
      check(late.getTracks().every(t=>t.readyState==='live'),'Позднее разрешение возвращает активный тестовый поток');
      allow(late); await pending;
      check(late.getTracks().every(t=>t.readyState==='ended')&&!recorder.enabled&&recorder.records.size===0,'Позднее разрешение после очистки не запускает запись');
      recorder.error=''; recorder.record(0).text='Первое озеро. Здесь профессор показывает только вашу речь. Аудио остаётся во временном буфере.';
      recorder.record(1).text='Второе озеро.'; recorder.setTarget(0);
      professors.update(.016,player,camera);
      check(guide.state.includes('Первое озеро')&&!guide.state.includes('Второе озеро'),'Результат нарисован на 3D-панели своего профессора');
      output.textContent+='\nВсе браузерные проверки расшифровки пройдены.';
    } catch(error) { output.textContent+='\nFAIL · '+error.message; console.error(error); }
    finally {
      navigator.mediaDevices.getUserMedia=originalCapture; window.fetch=originalFetch;
      await recorder.stop(false); source?.stop(); stream?.getTracks().forEach(t=>t.stop()); await synthetic?.close();
    }
  };
} catch(error) {output.textContent+='\nFAIL · '+error.message; console.error(error);}
