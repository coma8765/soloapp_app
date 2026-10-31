const B=window.BABYLON;
export class XRView {
 constructor(scene,player,planet,button,hudText){this.scene=scene;this.player=player;this.planet=planet;this.button=button;this.hudText=hudText;this.active=false;this.armed=true;this.aDown=false;this.visible=true;this.ready=this.init();}
 async init(){
   if(!navigator.xr||!isSecureContext){this.button.textContent='VR · нужен WebXR / HTTPS';this.button.disabled=true;return;}
   try{
     if(!await navigator.xr.isSessionSupported('immersive-vr')){this.button.textContent='VR · шлем не найден';this.button.disabled=true;return;}
     this.helper=await B.WebXRExperienceHelper.CreateAsync(this.scene);
     this.origin=new B.TransformNode('spherical XR origin',this.scene);this.origin.rotationQuaternion=B.Quaternion.Identity();
     this.helper.camera.parent=this.origin;
     // The XR camera uses tracked floor-relative poses; the parent supplies the planet frame.
     this.helper.camera.compensateOnFirstFrame=false;
     this.helper.sessionManager.onXRSessionInit.add(session=>{
       session.addEventListener('select',event=>this.authPanel?.selectXR(event,this.helper.sessionManager.referenceSpace,this.origin));
     });
     this.helper.sessionManager.onXRFrameObservable.add(frame=>{this.authPanel?.updateXR(frame,this.helper.sessionManager.referenceSpace,this.origin);this.marine?.updateXR(frame,this.helper.sessionManager.referenceSpace,this.origin);});
     this.helper.onStateChangedObservable.add(state=>{
       if(state===B.WebXRState.IN_XR)this.enter();
       if(state===B.WebXRState.NOT_IN_XR)this.exit();
     });
     this.button.textContent='Войти в VR · Quest';this.button.disabled=false;
     this.button.onclick=async()=>{
       if(!this.player.inputEnabled)return;
       document.exitPointerLock?.();this.savedOverview=this.player.overview;
       this.scene.activeCamera=this.helper.camera;this.helper.camera.position.set(0,0,0);this.helper.camera.rotationQuaternion.copyFrom(B.Quaternion.Identity());
       this.origin.position.copyFrom(this.player.position);this.origin.rotationQuaternion.copyFrom(this.player.rotation);
       const options=B.WebXRManagedOutputCanvasOptions.GetDefaults(this.scene.getEngine());
       options.canvasOptions.framebufferScaleFactor=this.highQuality?1.25:1;
       const target=this.helper.sessionManager.getWebXRRenderTarget(options);
       try{await this.helper.enterXRAsync('immersive-vr','local-floor',target);this.helper.sessionManager.onXRSessionEnded.addOnce(()=>target.dispose());}catch(e){target.dispose();this.exit();this.button.textContent='VR · повторить вход';console.warn('WebXR:',e.message);}
     };
     this.createHUD();
   }catch(e){this.button.textContent='VR недоступен';this.button.disabled=true;console.warn('WebXR:',e.message);}
 }
 createHUD(){
   this.hud=B.MeshBuilder.CreatePlane('VR statistics',{width:.48,height:.28},this.scene);this.hud.parent=this.helper.camera;this.hud.position.set(.36,-.25,-1);this.hud.isPickable=false;
   this.texture=new B.DynamicTexture('VR HUD',{width:768,height:448},this.scene,false);const mat=new B.StandardMaterial('VR HUD material',this.scene);mat.diffuseTexture=this.texture;mat.emissiveColor=B.Color3.White();mat.disableLighting=true;mat.backFaceCulling=false;this.hud.material=mat;this.hud.setEnabled(false);
 }
 enter(){this.active=true;this.planet.setXRQuality(true);this.player.xr=true;this.player.keys.clear();this.savedGrass=this.planet.grass.thinInstanceCount;this.planet.grass.thinInstanceCount=Math.min(this.highQuality?12000:6000,this.savedGrass);this.hud.setEnabled(this.visible);document.body.classList.add('in-vr');this.armed=true;this.aDown=false;this.bDown=false;this.xDown=false;
   if(this.authPanel){this.authPanel.xr=true;this.authPanel.recenter=true;if(!this.authPanel.auth.token)this.authPanel.auth.require();else this.authPanel.lobby?.show();}
 }
 exit(){if(this.active){this.planet.setXRQuality(false);this.planet.grass.thinInstanceCount=this.savedGrass;this.active=false;this.player.xr=false;this.hud.setEnabled(false);document.body.classList.remove('in-vr');}
   this.scene.activeCamera=this.player.overview?this.player.overviewCamera:this.player.camera;this.player.update(0);
   if(this.authPanel){this.authPanel.xr=false;this.authPanel.recenter=true;this.authPanel.hideRays();this.authPanel.sync();}
 }
 input(){if(!this.active)return null;
   const session=this.helper.sessionManager.session;if(session.visibilityState!=='visible'){this.armed=true;this.aDown=false;return B.Vector3.Zero();}
   let x=0,y=0,turn=0,pressed=false,menu=false,mic=false;
   for(const source of session.inputSources){const gp=source.gamepad;if(!gp)continue;const axes=gp.axes;
     if(source.handedness==='left'){mic=!!gp.buttons[4]?.pressed;x=axes.length>=4?axes[2]:axes[0]||0;y=axes.length>=4?axes[3]:axes[1]||0;}
     if(source.handedness==='right'){turn=axes.length>=4?axes[2]:axes[0]||0;pressed=!!gp.buttons[4]?.pressed;menu=!!gp.buttons[5]?.pressed;}
   }
   if(mic&&!this.xDown)this.toggleMicrophone?.();this.xDown=mic;
   if(pressed&&!this.aDown){this.visible=!this.visible;this.hud.setEnabled(this.visible);}this.aDown=pressed;
   if(menu&&!this.bDown)this.authPanel?.toggleMenu();this.bDown=menu;
   // Menu buttons remain usable while settings suspend locomotion.
   if(!this.player.inputEnabled)return B.Vector3.Zero();
   if(Math.abs(turn)<.3)this.armed=true;
   if(Math.abs(turn)>.7&&this.armed){
     this.armed=false;
     // Keep the headset fixed when rotating an off-centre, room-scale user.
     this.turn(-Math.sign(turn)*Math.PI/6);
   }
   const magnitude=Math.min(1,Math.hypot(x,y));if(magnitude<=.2)return B.Vector3.Zero();
   const up=this.player.up(),world=this.helper.camera.getWorldMatrix();
   let forward=B.Vector3.TransformNormal(new B.Vector3(0,0,-1),world);forward.subtractInPlace(up.scale(B.Vector3.Dot(forward,up))).normalize();if(forward.lengthSquared()<.01)forward=this.player.forward;
   return B.Vector3.Cross(forward,up).scale(x).add(forward.scale(-y)).normalize().scale((magnitude-.2)/.8);
 }
 turn(angle){const before=this.helper.camera.globalPosition.clone();this.player.turn(angle);this.player.update(0);this.sync();
   this.helper.camera.computeWorldMatrix();const after=this.helper.camera.globalPosition;
   this.origin.position.addInPlace(before.subtract(after));this.player.position.addInPlace(before.subtract(after));
 }
 sync(){if(!this.active)return;this.origin.position.copyFrom(this.player.position);this.origin.rotationQuaternion.copyFrom(this.player.rotation);this.origin.computeWorldMatrix(true);
   if(performance.now()>(this.nextHUD||0)){this.nextHUD=performance.now()+250;const c=this.texture.getContext();c.fillStyle='#102c32';c.fillRect(0,0,768,448);c.fillStyle='#e3f0db';c.font='26px sans-serif';this.hudText().split('\n').slice(0,11).forEach((s,i)=>c.fillText(s,24,43+i*35));this.texture.update();}
 }
}
