import {natureMaterial,waterMaterial,shadowDepthMaterial} from './materials.js';
import {WATER_RADIUS} from '../shared/world.js';
const B=window.BABYLON;
export const vec=a=>B.Vector3.FromArray(a);
export function orientation(forward,up){
 const f=forward.subtract(up.scale(B.Vector3.Dot(forward,up))).normalize();
 const right=B.Vector3.Cross(f,up).normalize();
 return B.Quaternion.RotationQuaternionFromAxis(right,up,f.negate());
}
function meshData(name,data,scene){
 const mesh=new B.Mesh(name,scene),v=new B.VertexData();
 v.positions=data.positions;v.normals=data.normals;v.uvs=data.uvs||Array(data.positions.length/3*2).fill(0);
 v.indices=data.indices?.length?data.indices:Array.from({length:data.positions.length/3},(_,i)=>i);
 v.applyToMesh(mesh);return mesh;
}
function sphereData(data,water=false){
 const {latitudes:h,longitudes:w,radii}=data,positions=[],indices=[],normals=[],uvs=[];
 for(let y=0;y<=h;y++)for(let x=0;x<=w;x++){
   const theta=Math.PI*y/h,phi=2*Math.PI*x/w,u=[Math.sin(theta)*Math.cos(phi),Math.cos(theta),Math.sin(theta)*Math.sin(phi)],r=radii[y*(w+1)+x];
   positions.push(...u.map(v=>v*(water?WATER_RADIUS:r)));normals.push(...u);uvs.push(water?Math.max(0,WATER_RADIUS-r):x/w,y/h);
 }
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const a=y*(w+1)+x,b=a+w+1;
   if(y>0)indices.push(a,b,a+1);
   if(y<h-1)indices.push(a+1,b,b+1);
 }
 if(!water){B.VertexData.ComputeNormals(positions,indices,normals,{useRightHandedSystem:true});
   // Preserve outward-facing normals regardless of winding convention.
   for(let i=0;i<normals.length;i+=3)if(normals[i]*positions[i]+normals[i+1]*positions[i+1]+normals[i+2]*positions[i+2]<0){normals[i]*=-1;normals[i+1]*=-1;normals[i+2]*=-1;}
 }
 return {positions,normals,uvs,indices};
}
export class PlanetScene {
 constructor(scene,data){
   this.scene=scene;this.data=data;this.materials=[];this.ripples=Array.from({length:16},()=>[0,36.8,0,-100]);this.strengths=Array(16).fill(0);this.rippleIndex=0;this.rippleCount=0;this.actors=new Map();this.time=0;
   scene.clearColor=new B.Color4(.64,.77,.82,1);
   const hemi=new B.HemisphericLight('sky',new B.Vector3(0,1,0),scene);hemi.intensity=.75;hemi.groundColor=new B.Color3(.3,.38,.4);
   const sun=new B.DirectionalLight('sun',new B.Vector3(.5,-1,-.4),scene);sun.intensity=.9;
   this.lights=[hemi,sun];this.visible=true;
   this.terrain=meshData('Original planet terrain',sphereData(data),scene);this.terrain.material=this.material(0);this.terrain.isPickable=true;
   this.bark=meshData('Original birch trunks and branches',data.bark,scene);this.bark.material=this.material(1);this.bark.isPickable=true;
   this.leaves=meshData('Original serrated birch leaves',data.leaf,scene);this.leaves.material=this.material(2);this.leaves.thinInstanceSetBuffer('matrix',new Float32Array(data.leaves),16,true);this.leaves.isPickable=false;
   this.grass=meshData('Original curved grass',data.grass,scene);this.grass.material=this.material(3);this.grass.thinInstanceSetBuffer('matrix',new Float32Array(data.grassMatrices),16,true);this.grass.isPickable=false;
   this.water=meshData('Lake surfaces',sphereData(data,true),scene);this.water.material=waterMaterial(scene);this.water.isPickable=false;this.water.alphaIndex=10;
   this.materials.push(this.water.material);
   this.trees=data.trees.map(vec);
   this.shadowCamera=new B.FreeCamera('sun shadow camera',new B.Vector3(-30,70,30),scene);
   this.shadowCamera.mode=B.Camera.ORTHOGRAPHIC_CAMERA;
   this.shadowCamera.orthoLeft=-23;this.shadowCamera.orthoRight=23;
   this.shadowCamera.orthoTop=23;this.shadowCamera.orthoBottom=-23;
   this.shadowCamera.minZ=1;this.shadowCamera.maxZ=140;
   this.shadowMap=new B.RenderTargetTexture('local sun shadows',2048,scene,false,true,B.Constants.TEXTURETYPE_UNSIGNED_BYTE,false,B.Texture.NEAREST_SAMPLINGMODE);
   this.shadowMap.activeCamera=this.shadowCamera;this.shadowMap.clearColor=new B.Color4(1,1,1,1);
   this.shadowCasters=[this.terrain,this.bark,this.leaves];this.shadowMap.renderList=this.shadowCasters;
   this.shadowDepths=this.shadowCasters.map((mesh,kind)=>{const material=shadowDepthMaterial(scene,kind);this.shadowMap.setMaterialForRendering(mesh,material);return material;});
   this.shadowMap.wrapU=B.Texture.CLAMP_ADDRESSMODE;this.shadowMap.wrapV=B.Texture.CLAMP_ADDRESSMODE;
   scene.customRenderTargets.push(this.shadowMap);
   for(const material of this.materials.slice(0,4)){material.setTexture('shadowMap',this.shadowMap);material.setFloat('shadowsEnabled',1);}
   this.shadows=true;
 }
 material(kind){const m=natureMaterial(this.scene,kind);this.materials.push(m);return m;}
 emitRipple(position,strength=1){this.ripples[this.rippleIndex]=[...position.normalizeToNew().scale(WATER_RADIUS).asArray(),this.time];this.strengths[this.rippleIndex]=strength;this.rippleIndex=(this.rippleIndex+1)%16;this.rippleCount++;}
 updateActor(id,position,dt){
   if(!this.visible)return;
   const wet=position.length()<WATER_RADIUS+.03,old=this.actors.get(id)||{position:position.clone(),wet:false,cooldown:0};
   let cooldown=Math.max(0,old.cooldown-dt);
   if(wet&&!old.wet){this.emitRipple(position,1.4);cooldown=.35;}
   else if(wet&&B.Vector3.Distance(position,old.position)/Math.max(dt,.001)>.45&&cooldown===0){this.emitRipple(position,.75);cooldown=.42;}
   this.actors.set(id,{position:position.clone(),wet,cooldown});
 }
 setVisible(visible){this.visible=visible;for(const mesh of [this.terrain,this.bark,this.leaves,this.grass,this.water])mesh.setEnabled(visible);for(const light of this.lights)light.setEnabled(visible);this.actors.clear();this.setXRQuality(this.xrQuality);}
 setXRQuality(active){this.xrQuality=active;this.shadows=!active&&this.visible;this.shadowMap.renderList=this.shadows?this.shadowCasters:[];for(const material of this.materials.slice(0,4))material.setFloat('shadowsEnabled',this.shadows?1:0);}
 update(dt,camera){if(!this.visible)return;this.time+=dt;
   const focus=camera.globalPosition.normalizeToNew().scale(38);
   this.shadowCamera.position=focus.add(new B.Vector3(-.5,1,.4).normalize().scale(70));this.shadowCamera.setTarget(focus);
   const matrix=this.shadowCamera.getViewMatrix().multiply(this.shadowCamera.getProjectionMatrix());
   for(const material of this.materials.slice(0,4))material.setMatrix('shadowMatrix',matrix);
   for(const material of this.shadowDepths)material.setFloat('time',this.time);for(const m of this.materials){m.setFloat('time',this.time);m.setVector3('cameraPosition',camera.globalPosition);}
   this.water.material.setArray4('ripples',this.ripples.flat());this.water.material.setFloats('strengths',this.strengths);
 }
}
function standard(name,color,scene){const m=new B.StandardMaterial(name,scene);m.diffuseColor=B.Color3.FromHexString(color);m.specularColor=new B.Color3(.2,.2,.2);return m;}
export function avatar(scene,id,local=false){
 const root=new B.TransformNode('player-'+id,scene);root.rotationQuaternion=B.Quaternion.Identity();
 const body=B.MeshBuilder.CreateCapsule('capsule',{height:1.8,radius:.35,tessellation:12,subdivisions:3},scene);body.parent=root;body.position.y=.9;
 const colors=['#dbad68','#5aa4b8','#bd7492','#83b365','#ae8bce','#e49362','#d8cb6a','#75bbb0'];body.material=standard('player-color-'+id,colors[id%8],scene);body.isPickable=false;
 const marker=B.MeshBuilder.CreateBox('look-direction',{width:.09,height:.08,depth:.45},scene);marker.parent=root;marker.position.set(0,1.5,-.45);marker.material=body.material;marker.isPickable=false;
 if(!local)avatarLabel(scene,id).parent=root;
 return root;
}
export function avatarLabel(scene,id){
   const plane=B.MeshBuilder.CreatePlane('id-label',{width:1.4,height:.45},scene);plane.position.y=2.2;plane.billboardMode=B.Mesh.BILLBOARDMODE_ALL;
   const tex=new B.DynamicTexture('label',{width:256,height:64},scene,false);tex.hasAlpha=true;tex.drawText('Игрок '+id,null,43,'bold 30px sans-serif','#ffffff','#173038cc',true);
   const mat=new B.StandardMaterial('label',scene);mat.diffuseTexture=tex;mat.emissiveColor=B.Color3.White();mat.disableLighting=true;mat.backFaceCulling=false;plane.material=mat;plane.isPickable=false;
 return plane;
}
export class FishView {
 constructor(scene,profiles=[]){this.scene=scene;this.fish=[];this.sequence=-1;this.last=0;this.time=0;this.blend=0;
   for(let id=0;id<48;id++){
     const root=new B.TransformNode('fish-'+id,scene);root.rotationQuaternion=B.Quaternion.Identity();root.setEnabled(false);
     const profile=profiles[id],size=profile?.size??(.7+(id*37%100)/100*.45);root.scaling.setAll(size);
     const scales=standard('scales-'+id,['#a79649','#b68b45','#c2ab61','#8e9145'][id%4],scene);if(profile)scales.diffuseColor=B.Color3.FromArray(profile.color);scales.specularPower=48;
     const fins=standard('fins-'+id,'#897235',scene);if(profile)fins.diffuseColor=B.Color3.FromArray(profile.color).scale(.8);fins.backFaceCulling=false;
     const eyes=standard('eyes-'+id,'#101c1b',scene);
     const ellipsoid=(name,pos,scale,material)=>{const m=B.MeshBuilder.CreateSphere(name,{diameter:2,segments:12},scene);m.parent=root;m.position=vec(pos);m.scaling=vec(scale);m.material=material;m.isPickable=false;};
     const fin=(parent,points)=>{const m=meshData('fin',{positions:points.flat(),normals:Array(9).fill(0)},scene);const normals=[];B.VertexData.ComputeNormals(points.flat(),[0,1,2],normals);m.setVerticesData('normal',normals);m.parent=parent;m.material=fins;m.isPickable=false;};
     ellipsoid('fish body',[0,0,0],[.085,.14,.29],scales);
     for(const s of [-1,1]){ellipsoid('eye',[s*.067,.05,-.18],[.022,.022,.022],eyes);fin(root,[[s*.06,-.03,-.08],[s*.22,-.08,.1],[s*.06,-.04,.12]]);}
     fin(root,[[0,.11,-.12],[0,.25,.09],[0,.1,.19]]);
     const tail=new B.TransformNode('tail',scene);tail.parent=root;tail.position.z=.24;fin(tail,[[0,0,0],[0,.18,.22],[0,-.18,.22]]);
     this.fish.push({root,tail,phase:profile?.phase??id*2.399963,from:B.Vector3.Zero(),target:B.Vector3.Zero(),rotation:B.Quaternion.Identity(),alarm:0});
   }
 }
 snapshot(m){if(!Number.isSafeInteger(m.sequence)||m.sequence<=this.sequence||!Number.isFinite(m.time)||!Array.isArray(m.fish)||m.fish.length!==48)return;
   if(m.fish.some((a,i)=>!Array.isArray(a)||a.length!==8||a[0]!==i||!a.every(Number.isFinite)||Math.hypot(...a.slice(1,4))<20||Math.hypot(...a.slice(1,4))>37))return;
   const first=this.sequence<0||performance.now()-this.last>3000;this.sequence=m.sequence;this.last=performance.now();this.time=m.time;this.blend=0;
   for(const a of m.fish){const f=this.fish[a[0]];if(!f)continue;f.target=vec(a.slice(1,4));f.from=first?f.target.clone():f.root.position.clone();f.rotation=orientation(vec(a.slice(4,7)),f.target.normalizeToNew());f.alarm=a[7];if(first){f.root.position.copyFrom(f.target);f.root.rotationQuaternion.copyFrom(f.rotation);}f.root.setEnabled(true);}
 }
 reset(){this.sequence=-1;this.last=0;for(const f of this.fish)f.root.setEnabled(false);}
 update(dt){this.blend=Math.min(1,this.blend+dt/.1);const age=(performance.now()-this.last)/1000;
   for(let i=0;i<this.fish.length;i++){const f=this.fish[i];f.root.setEnabled(this.sequence>=0&&age<3);f.root.position=B.Vector3.Lerp(f.from,f.target,this.blend);f.root.rotationQuaternion=B.Quaternion.Slerp(f.root.rotationQuaternion,f.rotation,1-Math.exp(-dt*12));f.tail.rotation.y=Math.sin((this.time+Math.min(age,.3))*8+f.phase)*(.3+f.alarm*.3);}
 }
}
