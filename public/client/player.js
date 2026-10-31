import {orientation,vec} from './scene.js';
import {LocalAvatar} from './local-avatar.js';
import {WATER_RADIUS,clamp} from '../shared/world.js';
const B=window.BABYLON;
export class Player {
 constructor(scene,terrain,planet,canvas,avatarId){
   this.inputEnabled=true;
   this.scene=scene;this.terrain=terrain;this.planet=planet;this.canvas=canvas;this.position=vec(terrain.spawn());this.forward=new B.Vector3(0,0,-1);this.pitch=-.18;this.radialSpeed=0;this.keys=new Set();this.third=false;this.overview=false;this.xr=false;this.angle=.6;this.speed=0;this.rotation=B.Quaternion.Identity();
   this.camera=new B.FreeCamera('player-view',this.position.clone(),scene);this.camera.inputs.clear();this.camera.minZ=.05;this.camera.maxZ=400;this.camera.fov=75*Math.PI/180;this.camera.rotationQuaternion=B.Quaternion.Identity();this.camera.updateUpVectorFromRotation=true;
   this.overviewCamera=new B.FreeCamera('overview',new B.Vector3(60,65,70),scene);this.overviewCamera.inputs.clear();this.overviewCamera.minZ=.1;this.overviewCamera.maxZ=400;this.overviewCamera.fov=55*Math.PI/180;
   this.avatar=new LocalAvatar(scene,avatarId);this.body=this.avatar.root;scene.activeCamera=this.camera;
   canvas.addEventListener('click',()=>{if(this.inputEnabled&&!this.overview&&!this.xr)canvas.requestPointerLock()?.catch(()=>{});});
   window.addEventListener('keydown',e=>{if(!this.inputEnabled||e.target.closest?.('input,textarea,select,button,[contenteditable]'))return;if(['Tab','KeyW','KeyA','KeyS','KeyD','Space'].includes(e.code))e.preventDefault();this.keys.add(e.code);if(e.repeat)return;
     if(e.code==='Tab'&&!this.xr)this.toggleOverview();if(e.code==='KeyV'&&!this.xr&&!this.overview)this.third=!this.third;
   });
   window.addEventListener('keyup',e=>this.keys.delete(e.code));
   window.addEventListener('blur',()=>{this.keys.clear();document.exitPointerLock();});
   document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement!==canvas)this.keys.clear();});
   window.addEventListener('mousemove',e=>{if(!this.inputEnabled||document.pointerLockElement!==canvas||this.overview||this.xr)return;this.turn(-e.movementX*.0025);this.pitch=clamp(this.pitch-e.movementY*.0025,-85*Math.PI/180,85*Math.PI/180);});
   this.update(0);
 }
 turn(angle){this.forward.rotateByQuaternionToRef(B.Quaternion.RotationAxis(this.position.normalizeToNew(),angle),this.forward);}
 toggleOverview(){this.overview=!this.overview;document.exitPointerLock();this.scene.activeCamera=this.overview?this.overviewCamera:this.camera;}
 spawn(id){this.position=vec(this.terrain.spawn((id-1)%8));this.radialSpeed=0;}
 state(sequence){return{type:'state',sequence,position:this.position.asArray(),rotation:this.rotation.asArray(),pitch:this.pitch};}
 update(dt,vrInput=null){
   if(!this.inputEnabled)return;
   const before=this.position.clone(),up=this.position.normalizeToNew();
   this.forward.subtractInPlace(up.scale(B.Vector3.Dot(this.forward,up))).normalize();
   if(this.forward.lengthSquared()<.1)this.forward=B.Vector3.Cross(up,B.Vector3.Right()).normalize();
   let direction=B.Vector3.Zero();
   if(this.xr&&vrInput)direction=vrInput;
   else if(!this.overview&&document.pointerLockElement===this.canvas){const x=Number(this.keys.has('KeyD'))-Number(this.keys.has('KeyA')),y=Number(this.keys.has('KeyW'))-Number(this.keys.has('KeyS'));direction=this.forward.scale(y).add(B.Vector3.Cross(this.forward,up).scale(x));if(direction.length()>1)direction.normalize();}
   const depth=Math.max(0,WATER_RADIUS-this.position.length()),speed=(this.xr?2.5:5.5)*(depth>.35?.58:1);
   let next=this.position.add(direction.scale(speed*dt));
   // Tree trunks use the same 0.18 m collider and 0.35 m player radius.
   for(const tree of this.planet.trees){
     const axis=tree.normalizeToNew(),offset=next.subtract(tree),height=B.Vector3.Dot(offset,axis);
     if(height< -1.8||height>6)continue;
     const tangent=offset.subtract(axis.scale(height)),d=tangent.length();
     if(d<.53){const outward=d>.001?tangent.scale(1/d):B.Vector3.Cross(axis,B.Vector3.Right()).normalize();next.addInPlace(outward.scale(.53-d));}
   }
   const u=next.normalizeToNew(),floor=this.terrain.radius(u.asArray())+.06;
   let radius=next.length();
   this.radialSpeed-= (depth>.5?8:18)*dt;
   radius+=this.radialSpeed*dt;
   if(radius<=floor){radius=floor;this.radialSpeed=0;}
   this.position=u.scale(radius);
   this.forward.subtractInPlace(u.scale(B.Vector3.Dot(this.forward,u))).normalize();
   this.rotation=orientation(this.forward,u);this.body.position.copyFrom(this.position);this.body.rotationQuaternion.copyFrom(this.rotation);
   this.speed=dt?B.Vector3.Distance(before,this.position)/dt:0;
   this.avatar.update(dt,this.speed,this.pitch,!this.xr&&(this.third||this.overview));
   const eye=this.position.add(u.scale(1.65)),look=this.forward.scale(Math.cos(this.pitch)).add(u.scale(Math.sin(this.pitch)));
   if(!this.xr){
     this.camera.position.copyFrom(eye);
     if(this.third){
       const back=look.negate(),ray=new B.Ray(eye,back,4),hit=this.scene.pickWithRay(ray,m=>m===this.planet.terrain||m===this.planet.bark);
       let distance=hit?.hit?Math.max(.15,hit.distance-.2):4;
       // Sample the camera arm as a small sphere to keep the near plane out of slopes.
       for(let d=.15;d<distance;d+=.1){const p=eye.add(back.scale(d));if(p.length()<this.terrain.radius(p.asArray())+.2){distance=Math.max(.15,d-.1);break;}}
       this.camera.position.addInPlace(back.scale(distance));
     }
     // Compose local pitch with the spherical body frame. setTarget() uses world Y
     // and intermittently overwrites upVector when the quaternion changes.
     this.camera.rotationQuaternion.copyFrom(this.rotation.multiply(B.Quaternion.RotationAxis(B.Axis.X,this.pitch)));
     if(this.overview){this.angle+=dt*.04;this.overviewCamera.position.set(Math.sin(this.angle)*83,65,Math.cos(this.angle)*83);this.overviewCamera.setTarget(B.Vector3.Zero());}
   }
 }
}
