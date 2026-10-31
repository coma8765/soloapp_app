const B = window.BABYLON;
const noise = `
float hash(vec3 p){p=fract(p*.3183099+vec3(.1,.2,.3));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float valueNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
`;
const vertex = `precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
uniform mat4 viewProjection;
uniform float time;
uniform float kind;
varying vec3 vPosition;
varying vec3 vNormal;
varying vec2 vUV;
#include<instancesDeclaration>
void main(){
#include<instancesVertex>
vec3 p=position;
vec3 anchor=(finalWorld*vec4(0.,0.,0.,1.)).xyz;
if(kind==2.)p.x+=sin(time*1.8+anchor.x*.65+anchor.z*.4+position.y*3.)*.022*uv.y;
if(kind==3.)p.x+=sin(time*1.6+anchor.x*.7+anchor.z*.55)*.075*uv.y*uv.y;
vPosition=(finalWorld*vec4(p,1.)).xyz;
vNormal=normalize(mat3(finalWorld)*normal);vUV=uv;
gl_Position=viewProjection*vec4(vPosition,1.);
}`;
const fragment = `precision highp float;
uniform float time;
uniform float kind;
uniform vec3 cameraPosition;
uniform sampler2D shadowMap;
uniform mat4 shadowMatrix;
uniform float shadowsEnabled;
varying vec3 vPosition;
varying vec3 vNormal;
varying vec2 vUV;
${noise}
void main(){
vec3 n=normalize(vNormal);if(!gl_FrontFacing)n=-n;
float r=length(vPosition),e=r-36.8;
float detail=valueNoise(vPosition*5.)*.55+valueNoise(vPosition*19.)*.3+valueNoise(vPosition*57.)*.15;
vec3 color;
if(kind==0.){
 vec3 grass=mix(vec3(.19,.34,.12),vec3(.40,.51,.23),smoothstep(.4,2.6,e));
 vec3 sand=vec3(.58,.53,.34),mud=vec3(.22,.29,.20),rock=vec3(.40,.42,.35);
 color=mix(mud,sand,smoothstep(-1.8,.05,e));color=mix(color,grass,smoothstep(.05,.65,e));
 float slope=1.-abs(dot(n,normalize(vPosition)));color=mix(color,rock,smoothstep(.12,.4,slope));
 color*=.72+detail*.62;
 if(e<0.)color+=vec3(.05,.09,.065)*pow(max(0.,1.-abs(sin(vPosition.x*3.7+sin(vPosition.z*2.1+time*.6))*cos(vPosition.z*4.3-time*.4))),20.);
}else if(kind==1.){
 float barkMark=valueNoise(vec3(vUV.x*15.,vUV.y*48.,.5));
 color=mix(vec3(.88,.88,.79),vec3(.14,.17,.16),smoothstep(.60,.72,barkMark));
 color*=.88+.18*detail;
}else if(kind==2.){
 color=mix(vec3(.19,.36,.08),vec3(.49,.63,.16),valueNoise(vPosition*2.));
 float vein=1.-smoothstep(.012,.035,abs(vUV.x-.5));color+=vec3(.08,.07,.015)*vein;
}else{
 color=mix(vec3(.17,.30,.07),vec3(.39,.52,.16),vUV.y);color*=.8+detail*.4;
}
float shadow=1.;
if(shadowsEnabled>.5){
 vec4 projected=shadowMatrix*vec4(vPosition+n*.035,1.);
 vec3 q=projected.xyz/projected.w*.5+.5;
 if(q.x>0.&&q.x<1.&&q.y>0.&&q.y<1.&&q.z>0.&&q.z<1.){
  float visible=0.;
  for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){
   vec4 depthSample=texture2D(shadowMap,q.xy+vec2(float(x),float(y))/2048.);
   float depth=dot(depthSample,vec4(1./16777216.,1./65536.,1./256.,1.));
   visible+=step(q.z-.0012,depth);
  }
  shadow=.32+.68*visible/9.;
 }
}
float sun=max(0.,dot(n,normalize(vec3(-.5,1.,.4))))*shadow;
float fill=max(0.,dot(n,normalize(vec3(.7,-.4,-.6))));
vec3 lit=color*(.52+sun*.65+fill*.25);
if(kind==2.||kind==3.)lit+=color*.12;
float fog=1.-exp(-pow(length(cameraPosition-vPosition)/180.,2.));
gl_FragColor=vec4(mix(lit,vec3(.64,.77,.81),fog),1.);
}`;
export function natureMaterial(scene,kind){
 const m=new B.ShaderMaterial('nature-'+kind,scene,{vertexSource:vertex,fragmentSource:fragment},{attributes:['position','normal','uv'],uniforms:['world','viewProjection','time','kind','cameraPosition','shadowMatrix','shadowsEnabled'],samplers:['shadowMap']});
 m.setFloat('shadowsEnabled',0);m.setMatrix('shadowMatrix',B.Matrix.Identity());m.setFloat('kind',kind);m.setFloat('time',0);m.backFaceCulling=false;
 return m;
}
export function waterMaterial(scene){
 const vert=`precision highp float;
 attribute vec3 position;attribute vec3 normal;attribute vec2 uv;
 uniform mat4 worldViewProjection;uniform float time;uniform vec4 ripples[16];uniform float strengths[16];
 varying vec3 p;varying float depth;
 void main(){p=position;depth=uv.x;float h=sin(dot(p,vec3(.8,.2,.6))*1.8-time*1.4)*.022+sin(dot(p,vec3(-.3,.7,.65))*3.1+time*1.2)*.012;
 for(int i=0;i<16;i++){float age=time-ripples[i].w;if(age>=0.&&age<3.5){float front=length(p-ripples[i].xyz)-age*2.2;h+=cos(front*7.5)*exp(-front*front/.7-age*.7)*strengths[i]*.035;}}
 gl_Position=worldViewProjection*vec4(position+normalize(position)*h*smoothstep(0.,.45,depth),1.);}`;
 const frag=`precision highp float;
 uniform float time;uniform vec3 cameraPosition;uniform vec4 ripples[16];uniform float strengths[16];
 varying vec3 p;varying float depth;
 ${noise}
 void main(){if(depth<.002)discard;
 vec3 unit=normalize(p),a=vec3(.8,.2,.6),b=vec3(-.3,.7,.65),c=vec3(.2,.55,-.8);
 vec3 gradient=a*cos(dot(p,a)*1.8-time*1.4)*.0396+b*cos(dot(p,b)*3.1+time*1.2)*.0372+c*cos(dot(p,c)*12.-time*2.1+sin(dot(p,a)*2.))*.096+a*cos(dot(p,a)*19.+time*2.5)*.057;
 float foam=0.;
 for(int i=0;i<16;i++){float age=time-ripples[i].w;if(age>=0.&&age<3.5){vec3 off=p-ripples[i].xyz;float d=length(off),front=d-age*2.2,fall=exp(-front*front/.7-age*.7)*strengths[i];gradient+=off/max(d,.01)*(-7.5*sin(front*7.5)-2.*front/.7*cos(front*7.5))*fall*.035;foam+=pow(max(cos(front*7.5),0.),8.)*fall*.16;}}
 gradient-=unit*dot(gradient,unit);vec3 n=normalize(unit-gradient*smoothstep(0.,.3,depth));
 vec3 view=normalize(cameraPosition-p);if(dot(n,view)<0.)n=-n;
 float fresnel=.02+.98*pow(1.-max(0.,dot(n,view)),5.);
 float noise=valueNoise(p*.6+time*.025),wash=.5+.5*sin(depth*20.-time*1.7+noise*5.);
 foam+=(1.-smoothstep(.04,.38,depth))*smoothstep(.38,.66,noise+wash*.15)*.65;foam=clamp(foam,0.,.7);
 vec3 color=mix(vec3(.075,.26,.22),vec3(.012,.085,.11),1.-exp(-depth*.65));
 color=mix(color,vec3(.64,.78,.84),fresnel*.8);
 float spec=pow(max(0.,dot(reflect(-normalize(vec3(-.5,1.,.4)),n),view)),100.);
 color+=vec3(1.,.95,.8)*spec*.75;color=mix(color,vec3(.72,.79,.71),foam);
 float alpha=clamp(mix((1.-exp(-depth*.85))*.72+.08,.96,fresnel)+foam*.5,.08,.98);
 if(length(cameraPosition)<36.8){alpha=.38+fresnel*.5;color*=vec3(.55,.8,.85);}
 gl_FragColor=vec4(color,alpha);}`;
 const m=new B.ShaderMaterial('lake-water',scene,{vertexSource:vert,fragmentSource:frag},{attributes:['position','normal','uv'],uniforms:['worldViewProjection','time','cameraPosition','ripples','strengths'],needAlphaBlending:true});
 m.backFaceCulling=false;m.alphaMode=B.Engine.ALPHA_COMBINE;
 m.setArray4('ripples',Array.from({length:16},()=>[0,36.8,0,-100]).flat());m.setFloats('strengths',Array(16).fill(0));m.setFloat('time',0);
 return m;
}

export function shadowDepthMaterial(scene,kind){
 const frag=`precision highp float;
 void main(){
  vec4 depth=fract(gl_FragCoord.z*vec4(16777216.,65536.,256.,1.));
  depth-=depth.xxyz*vec4(0.,1./256.,1./256.,1./256.);
  gl_FragColor=depth;
 }`;
 const material=new B.ShaderMaterial('shadow-depth-'+kind,scene,{vertexSource:vertex,fragmentSource:frag},{attributes:['position','normal','uv'],uniforms:['world','viewProjection','time','kind']});
 material.setFloat('kind',kind);material.setFloat('time',0);material.backFaceCulling=false;
 return material;
}
