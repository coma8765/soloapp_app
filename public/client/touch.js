import {clamp} from '../shared/world.js';

// Pointer IDs keep walking and looking independent during multi-touch input.
export class TouchControls {
 constructor(player,panel,xr,canvas,voice){
   Object.assign(this,{player,panel,xr,canvas,voice});
   this.pointers=new Map();this.active=false;
   this.media=matchMedia('(any-pointer: coarse)');
   this.root=document.createElement('section');this.root.id='touch-controls';
   this.root.setAttribute('aria-label','Сенсорное управление');this.root.hidden=true;
   this.root.innerHTML=`<div class="touch-movement" aria-label="Движение">
     <button data-move="forward" aria-label="Идти вперёд">▲</button>
     <button data-move="left" aria-label="Идти влево">◀</button>
     <button data-move="back" aria-label="Идти назад">▼</button>
     <button data-move="right" aria-label="Идти вправо">▶</button>
   </div><div class="touch-actions">
     <span class="touch-hint">Проведите по миру, чтобы осмотреться</span>
     <button data-action="menu">Меню</button><button data-action="view">Вид</button>
     <button data-action="overview">Обзор</button><button data-action="microphone" aria-pressed="false">Микрофон</button>
   </div>`;
   document.body.append(this.root);
   this.movement=[...this.root.querySelectorAll('[data-move]')];
   for(const button of this.movement){
     button.addEventListener('pointerdown',event=>{
       if(!this.active||player.overview)return;
       event.preventDefault();button.setPointerCapture(event.pointerId);
       this.pointers.set(event.pointerId,button.dataset.move);this.syncMovement();
     });
     const release=event=>{this.pointers.delete(event.pointerId);this.syncMovement();};
     for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,release);
     button.addEventListener('contextmenu',event=>event.preventDefault());
   }
   this.root.querySelector('[data-action="menu"]').onclick=()=>{this.release();panel.toggleMenu();};
   this.root.querySelector('[data-action="view"]').onclick=()=>{if(!player.overview)player.third=!player.third;};
   this.root.querySelector('[data-action="overview"]').onclick=()=>{this.release();player.toggleOverview();};
   this.mic=this.root.querySelector('[data-action="microphone"]');
   this.mic.onclick=()=>{voice.unlock();void voice.toggle();};
   canvas.addEventListener('pointerdown',event=>{
     if(!this.active||player.overview||event.pointerType==='mouse'||this.look)return;
     this.look={id:event.pointerId,x:event.clientX,y:event.clientY};
     canvas.setPointerCapture(event.pointerId);
   });
   canvas.addEventListener('pointermove',event=>{
     if(!this.active||this.look?.id!==event.pointerId)return;
     const dx=event.clientX-this.look.x,dy=event.clientY-this.look.y;
     player.turn(-dx*.004);player.pitch=clamp(player.pitch-dy*.004,-85*Math.PI/180,85*Math.PI/180);
     this.look.x=event.clientX;this.look.y=event.clientY;
   });
   for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,event=>{if(this.look?.id===event.pointerId)this.look=null;});
   window.addEventListener('blur',()=>this.release());
   window.addEventListener('pagehide',()=>this.release());
   document.addEventListener('visibilitychange',()=>{if(document.hidden)this.release();});
   const detect=()=>{this.enabled=this.media.matches;player.touchEnabled=this.enabled;document.body.classList.toggle('touch-device',this.enabled);this.release();};
   this.media.addEventListener('change',detect);detect();
   document.querySelector('.hint').textContent=this.enabled?'Кнопки — идти · жест по миру — смотреть':'WASD — идти · мышь — смотреть';
 }
 syncMovement(){
   const held=new Set(this.pointers.values());
   this.player.touchMove={x:Number(held.has('right'))-Number(held.has('left')),y:Number(held.has('forward'))-Number(held.has('back'))};
   for(const button of this.movement)button.classList.toggle('held',held.has(button.dataset.move));
 }
 release(){this.pointers.clear();this.look=null;this.syncMovement();}
 update(){
   this.active=this.enabled&&!this.xr.active&&!this.panel.visible&&this.player.inputEnabled&&!document.hidden;
   this.root.hidden=!this.active;
   if(!this.active||this.player.overview)this.release();
   for(const button of this.movement)button.disabled=this.player.overview;
   this.mic.disabled=!this.voice.available;
   this.mic.textContent=this.voice.pending?'Отменить':this.voice.enabled?'Микрофон вкл':'Микрофон выкл';
   this.mic.setAttribute('aria-pressed',String(this.voice.enabled));
   this.root.querySelector('[data-action="overview"]').textContent=this.player.overview?'Вернуться':'Обзор';
 }
}
