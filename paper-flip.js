import * as T from './vendor/three.module.js';
// Contact darkening belongs only where paper remains near the book block.
export function bindingContact(z){return Math.exp(-Math.max(0,z-.009)*90)}
// A front-facing book keeps the same page scale at every fold height.
export function createPaperCamera(width,height,pad=12,single=false){
 const rw=width*(single?1:2)+pad*2,rh=height+pad*2,worldH=rh/width,worldW=rw/width;
 const camera=new T.OrthographicCamera(-worldW/2,worldW/2,worldH/2,-worldH/2,.01,100);
 camera.position.set(single?.5:0,0,10);camera.lookAt(single?.5:0,0,0);camera.updateMatrixWorld();return camera;
}
// CPU fallback uses the same triangular surface, including diagonal folds.
export class CanvasPaperRenderer {
 constructor(){this.domElement=document.createElement('canvas');this.ctx=this.domElement.getContext('2d');this.ctx.imageSmoothingQuality='high';this.shadowCanvas=document.createElement('canvas');this.rasterCanvas=document.createElement('canvas');this.textureCache=new Map();this.shadowMap={};this.capabilities={getMaxAnisotropy:()=>1};this.ratio=1}
 setPixelRatio(r){this.ratio=Math.min(r,2)}
 setSize(w,h){this.width=w;this.height=h;for(const c of [this.domElement,this.shadowCanvas,this.rasterCanvas]){c.width=Math.round(w*this.ratio);c.height=Math.round(h*this.ratio)}this.rasterCanvas.width=Math.round(w*Math.min(this.ratio,1.5));this.rasterCanvas.height=Math.round(h*Math.min(this.ratio,1.5))}
 dispose(){for(const c of [this.domElement,this.shadowCanvas,this.rasterCanvas])c.width=c.height=0;this.textureCache.clear();this.rasterImage=null;this.depthBuffer=null}
 render(scene,camera){
  this.pageH=scene.userData.pageH;const ctx=this.ctx,r=this.ratio;ctx.setTransform(r,0,0,r,0,0);ctx.clearRect(0,0,this.width,this.height);scene.updateMatrixWorld();camera.updateMatrixWorld();const flat=[],faces=[],shadows=[];
  const project=v=>{const invW=camera.isOrthographicCamera?1:1/Math.max(.001,camera.position.z-v.z);v.project(camera);return {invW,x:(v.x*.5+.5)*this.width,y:(-.5*v.y+.5)*this.height,z:v.z}};
  const vertex=(m,j)=>{const v=new T.Vector3().fromBufferAttribute(m.geometry.attributes.position,j).applyMatrix4(m.matrixWorld),worldZ=v.z;const shadow=project(new T.Vector3(v.x+.28*worldZ,v.y-.44*worldZ,0));return {...project(v),worldZ,shadow}};
  scene.traverse(m=>{
   if(!m.isMesh||!m.material.map||!m.material.map.image)return;const img=m.material.map.image;if(!(img.naturalWidth||img.width))return;
   const cols=m.geometry.parameters.widthSegments||1,rows=m.geometry.parameters.heightSegments||1,uv=m.geometry.attributes.uv,normals=m.geometry.attributes.normal,bend=m.geometry.attributes.bend;
   if(cols===1){const p=[0,1,3,2].map(j=>vertex(m,j));flat.push({p,img,binding:m.material.userData.binding,spine:m.material.userData.bindingRight?p[1].x:p[0].x,pageWidth:Math.abs(p[1].x-p[0].x),direction:m.material.userData.bindingRight?-1:1});return}
   const spec=m.userData.foldSpec,mirror=m.userData.foldMirror||1;if(!spec)return;
   const start=[{x:0,y:this.pageH/2},{x:1,y:this.pageH/2},{x:1,y:-this.pageH/2},{x:0,y:-this.pageH/2}];
   const r0=Math.max(.00001,spec.radius),distance=p=>(p.x-spec.mx)*spec.nx+(p.y-spec.my)*spec.ny+Math.PI*r0/2;
   const clip=(poly,cut,keepHigh)=>{const out=[];if(!poly.length)return out;let a=poly[poly.length-1],da=distance(a)-cut,ina=keepHigh?da>=-1e-8:da<=1e-8;for(const b of poly){const db=distance(b)-cut,inb=keepHigh?db>=-1e-8:db<=1e-8;if(ina!==inb){const t=da/(da-db);out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t})}if(inb)out.push(b);a=b;da=db;ina=inb}return out};
   const cuts=[-10,0];for(let i=1;i<=64;i++)cuts.push(Math.PI*r0*i/64);cuts.push(10);
   for(let k=0;k<cuts.length-1;k++){const polygon=clip(clip(start,cuts[k],true),cuts[k+1],false);if(polygon.length<3)continue;
    const p=polygon.map(v=>{const point=foldPoint(v.x,v.y,spec);const world=new T.Vector3(mirror*point.x,point.y,point.z);return {...project(world.clone()),worldZ:world.z,shadow:project(new T.Vector3(world.x+.28*world.z,world.y-.44*world.z,0))}});
    let area=0;for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];area+=a.x*b.y-b.x*a.y}if(Math.abs(area)<.001)continue;const front=area>0;if(m.material.side===T.FrontSide&&!front||m.material.side===T.BackSide&&front)continue;
    const t=polygon.map(v=>({x:(v.x*m.material.map.repeat.x+m.material.map.offset.x)*(img.naturalWidth||img.width),y:(.5-v.y/this.pageH)*(img.naturalHeight||img.height)}));
    const angle=k===0?0:k===cuts.length-2?Math.PI:Math.max(0,Math.min(Math.PI,(cuts[k]+cuts[k+1])/(2*r0)));
    const normal=new T.Vector3(-spec.nx*Math.sin(angle)*mirror,-spec.ny*Math.sin(angle),Math.cos(angle)).multiplyScalar(mirror);if(!front)normal.negate();
    const bending=Math.sin(angle),nz=Math.max(0,normal.z);const gloss=Math.pow(Math.max(0,Math.abs(normal.x)*.45+normal.z*.893),28)*bending*.12;const shade=bending*(.035+.30*(1-nz));const raised=p.reduce((a,v)=>a+v.worldZ,0)/p.length;
    faces.push({p,t,img,gloss,shade,raised,binding:m.material.userData.binding*bindingContact(raised),spine:project(new T.Vector3(0,0,.009)).x,pageWidth:Math.abs(project(new T.Vector3(mirror,0,.009)).x-project(new T.Vector3(0,0,.009)).x),direction:mirror,planar:k===0||k===cuts.length-2,z:p.reduce((a,v)=>a+v.z,0)/p.length});if(raised>.018)shadows.push((front?p:[...p].reverse()).map(v=>v.shadow));
   }

  });
  for(const f of flat){ctx.drawImage(f.img,f.p[0].x,f.p[0].y,f.p[1].x-f.p[0].x,f.p[3].y-f.p[0].y);this.drawBinding(f)}
  faces.sort((a,b)=>b.z-a.z);for(const f of faces)if(f.raised<.014)this.drawFace(f);
  if(shadows.length){const sc=this.shadowCanvas.getContext('2d');sc.setTransform(r,0,0,r,0,0);sc.clearRect(0,0,this.width,this.height);sc.beginPath();for(const p of shadows){sc.moveTo(p[0].x,p[0].y);for(let j=1;j<p.length;j++)sc.lineTo(p[j].x,p[j].y);sc.closePath()}sc.fillStyle='#1b201b';sc.fill();ctx.save();ctx.globalAlpha=.22;ctx.filter='blur(8px)';ctx.drawImage(this.shadowCanvas,0,0,this.width,this.height);ctx.globalAlpha=.12;ctx.filter='blur(2px)';ctx.drawImage(this.shadowCanvas,0,0,this.width,this.height);ctx.restore()}
  const lifted=faces.filter(f=>f.raised>=.014),planar=lifted.filter(f=>f.planar);for(const f of planar)this.drawFace(f);this.rasterFaces(lifted.filter(f=>!f.planar),planar);ctx.setTransform(1,0,0,1,0,0)
 }
 // Resolve the lifted surface with one depth-tested pixel buffer. Canvas clip
 // antialiasing cannot composite dozens of subpixel strips without ghost seams.
 pixelsFor(img){let pixels=this.textureCache.get(img);if(!pixels){const c=document.createElement('canvas');c.width=img.naturalWidth||img.width;c.height=img.naturalHeight||img.height;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);pixels=ctx.getImageData(0,0,c.width,c.height);this.textureCache.set(img,pixels);if(this.textureCache.size>6)this.textureCache.delete(this.textureCache.keys().next().value)}return pixels}
 rasterFaces(faces,occluders=[]){if(!faces.length)return;const width=this.rasterCanvas.width,height=this.rasterCanvas.height,r=Math.min(this.ratio,1.5),ctx=this.rasterCanvas.getContext('2d');
  if(!this.rasterImage||this.rasterImage.width!==width||this.rasterImage.height!==height){this.rasterImage=ctx.createImageData(width,height);this.depthBuffer=new Float32Array(width*height)}
  const out=this.rasterImage.data,depth=this.depthBuffer;out.fill(0);depth.fill(Infinity);let minX=width,minY=height,maxX=0,maxY=0;
  for(const f of [...occluders.map(f=>({...f,depthOnly:true})),...faces]){const texture=f.depthOnly?{data:null,width:1,height:1}:this.pixelsFor(f.img),src=texture.data,tw=texture.width,th=texture.height;
   for(let j=1;j<f.p.length-1;j++){const ids=[0,j,j+1],p=ids.map(i=>({x:f.p[i].x*r,y:f.p[i].y*r,z:f.p[i].z,iw:f.p[i].invW})),t=ids.map(i=>f.t[i]),[a,b,c]=p,den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(Math.abs(den)<1e-8)continue;
    const x0=Math.max(0,Math.floor(Math.min(a.x,b.x,c.x))),x1=Math.min(width-1,Math.ceil(Math.max(a.x,b.x,c.x))),y0=Math.max(0,Math.floor(Math.min(a.y,b.y,c.y))),y1=Math.min(height-1,Math.ceil(Math.max(a.y,b.y,c.y)));minX=Math.min(minX,x0);minY=Math.min(minY,y0);maxX=Math.max(maxX,x1+1);maxY=Math.max(maxY,y1+1);
    for(let y=y0;y<=y1;y++){const py=y+.5;let low=Infinity,high=-Infinity;for(let edge=0;edge<3;edge++){const v0=p[edge],v1=p[(edge+1)%3];if(py>=Math.min(v0.y,v1.y)&&py<Math.max(v0.y,v1.y)){const hit=v0.x+(py-v0.y)*(v1.x-v0.x)/(v1.y-v0.y);low=Math.min(low,hit);high=Math.max(high,hit)}}for(let x=Math.max(x0,Math.ceil(low-.500001));x<=Math.min(x1,Math.floor(high-.499999));x++){const px=x+.5,w0=((b.y-c.y)*(px-c.x)+(c.x-b.x)*(py-c.y))/den,w1=((c.y-a.y)*(px-c.x)+(a.x-c.x)*(py-c.y))/den,w2=1-w0-w1;if(w0<-.000001||w1<-.000001||w2<-.000001)continue;
     const i=y*width+x,z=w0*a.z+w1*b.z+w2*c.z;if(z>=depth[i])continue;depth[i]=z;if(f.depthOnly)continue;const iw=w0*a.iw+w1*b.iw+w2*c.iw;
     const u=Math.max(0,Math.min(tw-1,(w0*t[0].x*a.iw+w1*t[1].x*b.iw+w2*t[2].x*c.iw)/iw)),v=Math.max(0,Math.min(th-1,(w0*t[0].y*a.iw+w1*t[1].y*b.iw+w2*t[2].y*c.iw)/iw)),sx=Math.floor(u),sy=Math.floor(v),fx=u-sx,fy=v-sy,ix=(sy*tw+sx)*4,ixR=(sy*tw+Math.min(tw-1,sx+1))*4,ixB=(Math.min(th-1,sy+1)*tw+sx)*4,ixBR=(Math.min(th-1,sy+1)*tw+Math.min(tw-1,sx+1))*4;
     const distance=(px/r-f.spine)*f.direction,contact=distance>=0&&distance<f.pageWidth*.085?f.binding*Math.exp(-48*distance/f.pageWidth):0,shade=f.shade,gloss=f.gloss;
     for(let k=0;k<3;k++){let color=(src[ix+k]*(1-fx)+src[ixR+k]*fx)*(1-fy)+(src[ixB+k]*(1-fx)+src[ixBR+k]*fx)*fy;color=color*(1-shade)+(k===0?16:k===1?22:19)*shade;color=color*(1-gloss)+255*gloss;out[i*4+k]=color*(1-contact)+12*contact}out[i*4+3]=255;
    }}
   }
  }
  if(maxX>minX&&maxY>minY){ctx.putImageData(this.rasterImage,0,0,minX,minY,maxX-minX,maxY-minY);this.ctx.drawImage(this.rasterCanvas,minX,minY,maxX-minX,maxY-minY,minX/r,minY/r,(maxX-minX)/r,(maxY-minY)/r)}
 }
 drawFace(f){const ctx=this.ctx;if(f.planar)this.triangle(f);else for(let j=1;j<f.p.length-1;j++)this.triangle({p:[f.p[0],f.p[j],f.p[j+1]],t:[f.t[0],f.t[j],f.t[j+1]],img:f.img});if(f.shade>.005||f.gloss>.006){ctx.save();ctx.beginPath();f.p.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();if(f.shade>.005){ctx.fillStyle='rgba(16,22,19,'+f.shade+')';ctx.fill()}if(f.gloss>.006){ctx.fillStyle='rgba(255,255,255,'+f.gloss+')';ctx.fill()}ctx.restore()}this.drawBinding(f)}
 drawBinding(f){if(!f.binding)return;const ctx=this.ctx;ctx.save();ctx.beginPath();f.p.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.clip();const extent=f.pageWidth*.085,g=ctx.createLinearGradient(f.spine,0,f.spine+f.direction*extent,0);g.addColorStop(0,'rgba(12,12,16,'+f.binding+')');g.addColorStop(.2,'rgba(12,12,16,'+f.binding*.64+')');g.addColorStop(.57,'rgba(12,12,16,'+f.binding*.16+')');g.addColorStop(1,'rgba(12,12,16,0)');ctx.fillStyle=g;ctx.fillRect(Math.min(f.spine,f.spine+f.direction*extent),0,extent,this.height);ctx.restore()}
 triangle(f){const ctx=this.ctx,p=f.p,t=f.t;const den=t[0].x*(t[1].y-t[2].y)+t[1].x*(t[2].y-t[0].y)+t[2].x*(t[0].y-t[1].y);if(Math.abs(den)<.00001)return;
  const solve=k=>[(p[0][k]*(t[1].y-t[2].y)+p[1][k]*(t[2].y-t[0].y)+p[2][k]*(t[0].y-t[1].y))/den,(p[0][k]*(t[2].x-t[1].x)+p[1][k]*(t[0].x-t[2].x)+p[2][k]*(t[1].x-t[0].x))/den,(p[0][k]*(t[1].x*t[2].y-t[2].x*t[1].y)+p[1][k]*(t[2].x*t[0].y-t[0].x*t[2].y)+p[2][k]*(t[0].x*t[1].y-t[1].x*t[0].y))/den];const x=solve('x'),y=solve('y'),cx=(p[0].x+p[1].x+p[2].x)/3,cy=(p[0].y+p[1].y+p[2].y)/3;
  ctx.save();ctx.beginPath();p.forEach((v,i)=>{const dx=v.x-cx,dy=v.y-cy,length=Math.hypot(dx,dy)||1,a=v.x+dx/length*(f.overlap??.45),b=v.y+dy/length*(f.overlap??.45);i?ctx.lineTo(a,b):ctx.moveTo(a,b)});ctx.closePath();ctx.clip();ctx.save();ctx.transform(x[0],y[0],x[1],y[1],x[2],y[2]);ctx.drawImage(f.img,0,0);ctx.restore();ctx.restore()
 }
}

// An isometric cylindrical fold around an arbitrary diagonal crease.
export function foldSpec(q,h,corner=-1,lift){
 q=Math.max(0,Math.min(1,q));const sign=corner<=0?1:-1,dx=2*q,arc=Math.sin(Math.PI*q);
 const maxLift=Math.sqrt(Math.max(0,1-(1-dx)*(1-dx)))*.94;
 const dy=Math.min(maxLift,Math.max(0,lift===undefined?h*.38*arc:lift));
 const length=Math.hypot(dx,dy)||1,nx=dx/length,ny=sign*dy/length,mx=1-q,my=sign*(h/2-dy/2);
 const spineMargin=nx*mx+ny*my-Math.abs(ny)*h/2;
 const radius=Math.max(0,Math.min(.12*arc,spineMargin*1.8/Math.PI));
 return {q,nx,ny,mx,my,radius,sign};
}
export function foldPoint(x,y,s){
 if(s.q===0)return {x,y,z:.009,bend:0};if(s.q===1)return {x:-x,y,z:.009,bend:0};
 const r=Math.max(.00001,s.radius),d=(x-s.mx)*s.nx+(y-s.my)*s.ny+Math.PI*r/2;
 if(d<=0)return {x,y,z:.009,bend:0};const angle=Math.min(Math.PI,d/r);const mapped=d>=Math.PI*r?Math.PI*r-d:r*Math.sin(angle);const z=d>=Math.PI*r?2*r:r*(1-Math.cos(angle));
 return {x:x+s.nx*(mapped-d),y:y+s.ny*(mapped-d),z:z+.009,bend:Math.sin(angle)};
}

// A flexible sheet, anchored at the spine. Each column follows the integral
// of a changing tangent angle, rather than rotating one rigid rectangle.
export class PageFlip {
 constructor(el,options){
  this.el=el;this.o=options;this.width=options.width;this.height=options.height;this.w=1;this.h=options.height/options.width;this.index=0;this.events={};this.pages=[];this.textures=[];this.drag=null;this.motion=null;this.dead=false;this.disposables=[];this.single=options.singlePage===true;this.cover=options.showCover!==false;this.sheet=null;
  try{if(options.renderer==='canvas')throw Error('Canvas requested');this.renderer=new T.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});}catch(e){this.renderer=new CanvasPaperRenderer()}
  this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.NoToneMapping;this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;
  const pad=12;this.pad=pad;this.el.style.cssText=`position:relative;width:${this.width*(this.single?1:2)}px;height:${this.height}px;flex-shrink:0;touch-action:none;cursor:grab;`;
  const cv=this.renderer.domElement;cv.style.cssText=`position:absolute;left:-${pad}px;top:-${pad}px;width:calc(100% + ${pad*2}px);height:calc(100% + ${pad*2}px);touch-action:none;filter:drop-shadow(0 8px 9px #233d3020);`;cv.setAttribute('aria-label','Flipbook dengan halaman lentur. Geser ke kiri atau kanan untuk membalik.');cv.setAttribute('role','img');this.el.append(cv);
  const rw=this.width*(this.single?1:2)+pad*2,rh=this.height+pad*2;this.renderer.setSize(rw,rh,false);this.scene=new T.Scene();this.scene.userData.pageH=this.h;this.camera=createPaperCamera(this.width,this.height,pad,this.single);
  this.scene.add(new T.AmbientLight(0xffffff,2.1));const light=new T.DirectionalLight(0xfff7e9,2.7);light.position.set(-2,4,7);light.castShadow=true;light.shadow.mapSize.set(1024,1024);Object.assign(light.shadow.camera,{left:-3,right:3,top:3,bottom:-3,near:.1,far:15});light.shadow.bias=-.0005;light.shadow.normalBias=.015;light.shadow.radius=4;this.scene.add(light);
  this.ground=new T.Mesh(new T.PlaneGeometry(7,6),new T.ShadowMaterial({opacity:.18}));this.ground.position.z=-.035;this.ground.receiveShadow=true;this.scene.add(this.ground);
  this.group=new T.Group();this.scene.add(this.group);
  this.onDown=e=>this.pointerDown(e);this.onMove=e=>this.pointerMove(e);this.onUp=e=>this.pointerUp(e);this.onCancel=e=>this.pointerUp(e,true);
  cv.addEventListener('pointerdown',this.onDown);cv.addEventListener('pointermove',this.onMove);cv.addEventListener('pointerup',this.onUp);cv.addEventListener('pointercancel',this.onCancel);this.onLeave=()=>{if(!this.drag)this.hideHint()};cv.addEventListener('pointerleave',this.onLeave);
  this.onLost=()=>{if(this.drag)this.pointerUp(null,true)};cv.addEventListener('lostpointercapture',this.onLost);
 }
 on(name,cb){(this.events[name]??=[]).push(cb)} emit(name,data){for(const cb of this.events[name]||[])cb({data,object:this})}
 getPageCount(){return this.pages.length} getCurrentPageIndex(){return this.index}
 getSpreadCount(){return this.cover?1+Math.floor(this.pages.length/2):Math.ceil(this.pages.length/2)}
 getSpreadIndex(){return this.sourceSpreadIndex(this.index)}
 sourceSpreadIndex(i){return this.cover?(i===0?0:1+Math.floor((i-1)/2)):Math.floor(i/2)}
 spreadStart(i){return this.cover?(i===0?0:i*2-1):i*2}
 getVisiblePageIndices(){const sides=this.currentSides();return [sides.left,sides.right].filter(i=>i>=0&&i<this.pages.length)}
 loadFromHTML(nodes){this.pages=[...nodes];this.textures=this.pages.map((node,i)=>this.textureFor(node,i));this.pages.forEach(n=>n.remove());this.refresh();this.emit('init',{page:0});this.emit('changeOrientation',this.single?'portrait':'landscape')}
 textureFor(node,i){let image=node.querySelector('img');let texture;
  if(image){texture=new T.Texture(image);const ready=()=>{if(i===0&&this.cover)this.finishCover(texture);texture.needsUpdate=true;this.render()};if(image.complete&&image.naturalWidth)ready();else image.addEventListener('load',ready,{once:true});}
  else {const c=document.createElement('canvas');c.width=1000;c.height=Math.round(1000*this.h);const ctx=c.getContext('2d');const demo=node.querySelector('.demo-page');const dark=demo?.classList.contains('cover-demo');ctx.fillStyle=dark?'#101012':'#f5f4f0';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle=dark?'#ededee':'#131316';ctx.font='20px Arial';ctx.fillText(demo?.querySelector('small')?.textContent||'FLIPFOLIO',90,130);ctx.font='600 78px Segoe UI, Arial';let lines=(demo?.querySelector('h2')?.innerHTML||'Flipbook').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'').split('\n');let y=320;for(const line of lines){ctx.fillText(line,90,y,820);y+=94}if(i===0){const g=ctx.createRadialGradient(460,650,20,540,780,260);g.addColorStop(0,'#d9dadd');g.addColorStop(.6,'#686a74');g.addColorStop(1,'#151518');ctx.fillStyle=g;ctx.beginPath();ctx.arc(540,780,250,0,Math.PI*2);ctx.fill();y=1150}else y+=100;ctx.fillStyle=dark?'#ededee':'#131316';ctx.font='30px Segoe UI, Arial';const words=(demo?.querySelector('p')?.textContent||'').split(' ');let row='';for(const word of words){if(ctx.measureText(row+word).width>800){ctx.fillText(row,90,y);row='';y+=51}row+=word+' '}ctx.fillText(row,90,y);ctx.font='18px Arial';ctx.fillText(String(i+1).padStart(2,'0'),90,c.height-75);texture=new T.CanvasTexture(c)}
  if(!image&&i===0&&this.cover)this.finishCover(texture);
  texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());this.disposables.push(texture);return texture;
 }
 // Bake a restrained relief from artwork luminance, then add binding and edge light.
 // The baked version also works in the CPU renderer and in offline exports.
 finishCover(texture){
  const source=texture.image,w=Math.min(1600,source.naturalWidth||source.width),h=Math.round(w*this.h);if(!w||!h)return;
  const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0,w,h);
  try{const pixels=ctx.getImageData(0,0,w,h),d=pixels.data,lum=new Float32Array(w*h);for(let i=0;i<lum.length;i++)lum[i]=(d[i*4]*.2126+d[i*4+1]*.7152+d[i*4+2]*.0722)/255;
   const step=Math.max(1,Math.round(w/900));for(let y=step;y<h-step;y++)for(let x=step;x<w-step;x++){const i=y*w+x,j=i*4,relief=Math.max(-15,Math.min(15,(lum[i-step-w*step]-lum[i+step+w*step])*20));for(let k=0;k<3;k++)d[j+k]=Math.max(0,Math.min(255,d[j+k]+relief))}ctx.putImageData(pixels,0,0);
   const bump=document.createElement('canvas');bump.width=w;bump.height=h;const b=bump.getContext('2d'),data=b.createImageData(w,h);for(let i=0;i<lum.length;i++){const grain=((i*13%23)/23-.5)*5,value=128+lum[i]*45+grain;data.data[i*4]=data.data[i*4+1]=data.data[i*4+2]=value;data.data[i*4+3]=255}b.putImageData(data,0,0);this.coverBump=new T.CanvasTexture(bump);this.disposables.push(this.coverBump);
  }catch{/* Cross-origin artwork retains binding and edge light without pixel access. */}
  const spine=ctx.createLinearGradient(0,0,w*.12,0);spine.addColorStop(0,'#0008');spine.addColorStop(.16,'#ffffff0d');spine.addColorStop(.31,'#00000030');spine.addColorStop(.43,'#00000050');spine.addColorStop(.58,'#ffffff16');spine.addColorStop(1,'#0000');ctx.fillStyle=spine;ctx.fillRect(0,0,w*.12,h);
  const sheen=ctx.createLinearGradient(0,0,w,h);sheen.addColorStop(0,'#ffffff15');sheen.addColorStop(.38,'#ffffff03');sheen.addColorStop(.62,'#00000000');sheen.addColorStop(1,'#00000016');ctx.fillStyle=sheen;ctx.fillRect(0,0,w,h);
  texture.image=c;texture.userData.embossedCover=true;texture.needsUpdate=true;for(const m of this.frameMaterials||[])if(m.map===texture){m.bumpMap=this.coverBump;m.bumpScale=.012;m.roughness=.5;m.clearcoat=.48;m.clearcoatRoughness=.28;m.needsUpdate=true}
 }
 bookBlock(){
  if(!this.blockTexture){const c=document.createElement('canvas');c.width=400;c.height=Math.round(400*this.h);const ctx=c.getContext('2d');ctx.fillStyle='#65615a';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#f5f2eb';ctx.fillRect(3,0,c.width-7,c.height-5);for(let y=0;y<c.height;y+=3){ctx.fillStyle=y%2?'#cec9bf':'#e4dfd5';ctx.fillRect(c.width-6,y,4,1)}for(let y=c.height-11;y<c.height-3;y+=2){ctx.fillStyle='#b1aba0';ctx.fillRect(4,y,c.width-10,1)}ctx.fillStyle='#39393c';ctx.fillRect(0,c.height-3,c.width,3);this.blockTexture=new T.CanvasTexture(c);this.blockTexture.colorSpace=T.SRGBColorSpace;this.disposables.push(this.blockTexture)}
  const block=new T.Mesh(new T.PlaneGeometry(.982,this.h-.012),this.material(this.blockTexture,T.FrontSide,false,false,false));block.position.set(.5,-.016,-.028);block.castShadow=true;this.group.add(block);
 }
 material(tex,side=T.FrontSide,mirror=false,bindingRight=false,binding=true){let map=tex;if(mirror&&tex){map=tex.clone();map.repeat.x=-1;map.offset.x=1;map.needsUpdate=true;(this.frameTextures??=[]).push(map)}const m=new T.MeshPhysicalMaterial({map,color:map?0xffffff:0xfbf9f2,roughness:.38,metalness:0,clearcoat:.82,clearcoatRoughness:.15,specularIntensity:.65,ior:1.46,side,toneMapped:false});if(tex?.userData.embossedCover){m.bumpMap=this.coverBump;m.bumpScale=.012;m.roughness=.5;m.clearcoat=.48;m.clearcoatRoughness=.28}m.userData.binding=binding?(tex?.userData?.embossedCover ? .10 : .18):0;m.userData.bindingRight=bindingRight;
  // Printed artwork is display-referred sRGB, not a lit paint/albedo sample.
  // Keep the texture neutral; apply only contact/cast shadows and local fold finish.
  m.onBeforeCompile=shader=>{
   const varyings='\nvarying float vBindingDistance;\nvarying float vPageLift;\nvarying vec3 vPaperNormal;';
   shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>'+varyings).replace('#include <uv_vertex>','#include <uv_vertex>\nvBindingDistance = '+(bindingRight?'1.0 - uv.x':'uv.x')+';\nvPageLift = max(0.0, position.z - 0.009);\nvPaperNormal = normal;');
   shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>'+varyings).replace('#include <shadowmap_pars_fragment>','#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>').replace('#include <map_fragment>','#include <map_fragment>\nfloat bindingShade = exp(-vBindingDistance * 48.0) * '+m.userData.binding.toFixed(3)+' * exp(-vPageLift * 90.0);\ndiffuseColor.rgb *= 1.0 - bindingShade;').replace('#include <opaque_fragment>',`
vec3 paperNormal = normalize(vPaperNormal);
float paperBend = sqrt(max(0.0, 1.0 - paperNormal.z * paperNormal.z));
float paperShade = paperBend * (0.035 + 0.30 * (1.0 - abs(paperNormal.z)));
float paperGloss = pow(max(0.0, abs(paperNormal.x) * 0.45 + abs(paperNormal.z) * 0.893), 28.0) * paperBend * 0.12;
outgoingLight = diffuseColor.rgb * mix(1.0, getShadowMask(), 0.24);
outgoingLight = mix(outgoingLight, vec3(0.0052, 0.0080, 0.0065), paperShade);
outgoingLight = mix(outgoingLight, vec3(1.0), paperGloss);
#include <opaque_fragment>`);
  };m.customProgramCacheKey=()=>`paper-print-color-v1-${bindingRight}-${m.userData.binding}`;
  this.frameMaterials??=[];this.frameMaterials.push(m);return m}
 clear(){while(this.group.children.length){const m=this.group.children[0];this.group.remove(m);if(m.geometry)m.geometry.dispose()}for(const m of this.frameMaterials||[])m.dispose();this.frameMaterials=[];for(const t of this.frameTextures||[])t.dispose();this.frameTextures=[];this.sheet=null}
 blankPaper(){if(!this.blankTexture){const c=document.createElement('canvas');c.width=c.height=8;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,8,8);this.blankTexture=new T.CanvasTexture(c);this.blankTexture.colorSpace=T.SRGBColorSpace;this.disposables.push(this.blankTexture)}return this.blankTexture}
 flat(i,left=false,z=0){if(i<0)return;const m=new T.Mesh(new T.PlaneGeometry(1,this.h),this.material(this.textures[i]||this.blankPaper(),T.FrontSide,false,left));m.position.set(left?-.5:.5,0,z);m.castShadow=true;m.receiveShadow=true;this.group.add(m)}
 currentSides(){return this.single?{left:-1,right:this.index}:this.cover&&this.index===0?{left:-1,right:0}:{left:this.index,right:this.index+1}}
 refresh(){if(this.dead)return;this.clear();if(this.cover&&this.index===0)this.bookBlock();const s=this.currentSides();if(!this.single)this.flat(s.left,true);this.flat(s.right);this.render()}
 render(){if(!this.dead)this.renderer.render(this.scene,this.camera)}
 turnToPage(n){if(this.dead)return;this.cancelMotion();let i=Math.max(0,Math.min(this.pages.length-1,n));this.index=this.single?i:this.spreadStart(this.sourceSpreadIndex(i));this.refresh();this.emit('flip',this.index)}
 targetIndex(dir){if(this.single)return this.index+dir;if(this.cover)return dir>0?(this.index===0?1:this.index+2):(this.index<=1?0:this.index-2);return this.index+dir*2}
 canTurn(dir){const n=this.targetIndex(dir);return n>=0&&n<this.pages.length&&n!==this.index}
 flipNext(){this.start(1)} flipPrev(){this.start(-1)}
 start(dir,corner=-1,initialP=0){if(this.motion||this.drag||!this.canTurn(dir))return;if(this.hint?.dir===dir){initialP=this.hint.p;corner=this.hint.corner}this.stopHint(false);this.beginSheet(dir);this.motion={p:initialP,v:0,target:1,corner,last:performance.now()};this.tick()}
 beginSheet(dir){this.clear();if(this.cover&&this.index===0)this.bookBlock();this.dir=dir;const s=this.currentSides();let front,back;
  if(this.single){if(dir>0){this.flat(this.index+1);front=this.index;back=this.index+1}else{this.flat(this.index);front=this.index-1;back=this.index}}else if(dir>0){this.flat(s.left,true);this.flat(s.right+2);front=s.right;back=s.right+1}else{this.flat(s.left-2,true);this.flat(s.right);front=s.left;back=s.left-1}
  const geo=new T.PlaneGeometry(1,this.h,96,80);const f=new T.Mesh(geo,this.material(this.textures[front],T.FrontSide,!this.single&&dir<0));const b=new T.Mesh(geo,this.material(this.textures[back],T.BackSide,this.single||dir>0));if(!this.single&&dir<0){f.material.side=T.BackSide;b.material.side=T.FrontSide}geo.setAttribute('bend',new T.Float32BufferAttribute(new Float32Array(geo.attributes.position.count),1));f.castShadow=b.castShadow=true;f.receiveShadow=b.receiveShadow=true;this.group.add(f,b);this.sheet={geo,f,b};this.shape(0,0)
 }
 shape(p,velocity=0,corner=-1,lift){
  if(!this.sheet)return;const q=Math.max(0,Math.min(1,this.single&&this.dir<0?1-p:p));const mirror=!this.single&&this.dir<0?-1:1;const spec=foldSpec(q,this.h,corner,lift);this.fold=spec;
  const pos=this.sheet.geo.attributes.position,bend=this.sheet.geo.attributes.bend,cols=96,rows=80;
  for(let row=0;row<=rows;row++)for(let col=0;col<=cols;col++){const x=col/cols,y=(.5-row/rows)*this.h,point=foldPoint(x,y,spec),i=row*(cols+1)+col;pos.setXYZ(i,mirror*point.x,point.y,point.z);bend.setX(i,point.bend)}
  this.sheet.f.userData.foldSpec=this.sheet.b.userData.foldSpec=spec;this.sheet.f.userData.foldMirror=this.sheet.b.userData.foldMirror=mirror;pos.needsUpdate=true;bend.needsUpdate=true;this.sheet.geo.computeVertexNormals();this.render()
 }
 tick(){if(this.dead||!this.motion)return;const m=this.motion;const now=performance.now();m.started??=m.last;let dt=Math.min((now-m.last)/1000,.5);m.last=now;while(dt>0){const step=Math.min(dt,1/120);const acceleration=(m.target-m.p)*64-m.v*13.2;m.v+=acceleration*step;m.p+=m.v*step;dt-=step}if(now-m.started>1800){m.p=m.target;m.v=0}const lift=m.lift===undefined?undefined:m.lift*Math.sin(Math.PI*Math.max(0,Math.min(1,m.p)))/Math.max(.04,Math.sin(Math.PI*m.initialP));this.shape(m.p,m.v,m.corner??-1,lift);if(Math.abs(m.target-m.p)<.0008&&Math.abs(m.v)<.007){const commit=m.target===1;this.motion=null;if(commit)this.index=this.targetIndex(this.dir);this.refresh();if(commit)this.emit('flip',this.index);this.emit('changeState','read');return}this.raf=requestAnimationFrame(()=>this.tick())}
 // Hover previews never change the source index or emit a page flip.
 hintAt(e){
  if(e.pointerType==='touch'||this.motion||this.drag||this.dead)return;
  const r=this.renderer.domElement.getBoundingClientRect(),scale=r.width/(this.width*(this.single?1:2)+this.pad*2),x=(e.clientX-r.left-this.pad*scale)/(this.width*scale),y=(e.clientY-r.top-this.pad*scale)/(this.height*scale),edge=.18;
  const dir=this.single?(x<edge?-1:x>1-edge?1:0):(x<edge?-1:x>2-edge?1:0);
  if(x<-.02||x>(this.single?1:2)+.02||y<-.02||y>1.02||!dir||(y>edge&&y<1-edge)||!this.canTurn(dir)){this.hideHint();return}
  const corner=y<.5?-1:1;if(this.hint?.dir===dir&&this.hint.corner===corner){this.hint.target=.075;return}
  this.stopHint(false);this.beginSheet(dir);this.hint={dir,corner,p:0,target:.075,last:performance.now()};this.emit('changeState','hover');this.animateHint();
 }
 animateHint(){const a=this.hint;if(!a||this.dead)return;const now=performance.now(),dt=Math.min(.05,(now-a.last)/1000);a.last=now;a.p+=(a.target-a.p)*(1-Math.exp(-dt*14));this.shape(a.p,0,a.corner,this.h*.19*Math.min(1,a.p/.075));
  if(Math.abs(a.p-a.target)<.0004){a.p=a.target;if(a.target===0){this.hint=null;this.refresh();this.emit('changeState','read')}else this.shape(a.p,0,a.corner,this.h*.19);return}this.hintRaf=requestAnimationFrame(()=>this.animateHint())
 }
 hideHint(){if(!this.hint||this.hint.target===0)return;this.hint.target=0;this.hint.last=performance.now();cancelAnimationFrame(this.hintRaf);this.animateHint()}
 stopHint(restore=true){cancelAnimationFrame(this.hintRaf);const had=!!this.hint;this.hint=null;if(had&&restore)this.refresh()}
 pointerDown(e){if(this.motion||e.button!==0)return;const r=this.renderer.domElement.getBoundingClientRect();const scale=r.width/(this.width*(this.single?1:2)+this.pad*2);const x=(e.clientX-r.left-this.pad*scale)/(this.width*scale);let dir=this.single?1:x>1?1:-1;if(!this.canTurn(dir)&&this.single&&this.canTurn(-1))dir=-1;if(!this.canTurn(dir))return;const initialP=this.hint?.dir===dir?this.hint.p:0;this.stopHint(false);this.drag={id:e.pointerId,x:e.clientX,y:e.clientY,start:performance.now(),lastX:e.clientX,lastT:performance.now(),p:initialP,startP:initialP,v:0,dir,active:false,corner:e.clientY<r.top+r.height/2?-1:1,scale,lift:0};this.renderer.domElement.setPointerCapture(e.pointerId);this.el.style.cursor='grabbing'}
 pointerMove(e){const d=this.drag;if(!d){this.hintAt(e);return}if(e.pointerId!==d.id)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;if(!d.active){if(Math.hypot(dx,dy)<5)return;if(this.single){d.dir=dx<0?1:-1;if(!this.canTurn(d.dir))return}this.beginSheet(d.dir);d.active=true;this.emit('changeState','user_fold')}
  const now=performance.now(),elapsed=Math.max(8,now-d.lastT);const direction=d.dir;d.v=(-(e.clientX-d.lastX)*direction/this.width)/(elapsed/1000);d.lastT=now;d.lastX=e.clientX;d.p=Math.max(0,Math.min(1,d.startP-dx*direction/(2*this.width*d.scale)));d.lift=Math.max(0,dy/(this.width*d.scale)*(d.corner<0?1:-1));this.shape(d.p,d.v,d.corner,d.lift);e.preventDefault()
 }
 pointerUp(e,cancel=false){const d=this.drag;if(!d)return;this.drag=null;this.el.style.cursor='grab';if(e&&this.renderer.domElement.hasPointerCapture(e.pointerId))this.renderer.domElement.releasePointerCapture(e.pointerId);if(!d.active){if(!cancel)this.start(d.dir,d.corner,d.startP);else this.refresh();return}const commit=!cancel&&(d.p>.27||(d.p>.06&&d.v>.65));this.motion={p:d.p,v:Math.max(-1.7,Math.min(1.7,d.v)),target:commit?1:0,last:performance.now(),corner:d.corner,lift:d.lift,initialP:d.p};this.tick()}
 cancelMotion(){cancelAnimationFrame(this.raf);this.stopHint(false);this.motion=null;this.drag=null}
 destroy(){this.dead=true;this.cancelMotion();this.clear();for(const t of this.disposables)t.dispose();this.ground.geometry.dispose();this.ground.material.dispose();this.renderer.dispose();this.renderer.domElement.remove();this.el.remove()}
}
