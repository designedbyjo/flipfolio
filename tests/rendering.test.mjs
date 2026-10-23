import test from 'node:test';
import assert from 'node:assert/strict';
import {CanvasPaperRenderer,createPaperCamera,foldSpec,foldPoint,PageFlip} from '../paper-flip.js';
import * as T from '../vendor/three.module.js';
function renderer(width=16,height=16){const r=Object.create(CanvasPaperRenderer.prototype),ctx={createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),putImageData(){}};Object.assign(r,{ratio:1,rasterCanvas:{width,height,getContext:()=>ctx},ctx:{drawImage(){}},pixelsFor:img=>img});return r}
const texture=(a,b=a)=>({width:2,height:2,data:new Uint8ClampedArray([...a,255,...b,255,...a,255,...b,255])});
function quad(img,x0=0,x1=16,z=.2,u0=0,u1=1){return {img,p:[{x:x0,y:0,z,invW:1},{x:x1,y:0,z,invW:1},{x:x1,y:16,z,invW:1},{x:x0,y:16,z,invW:1}],t:[{x:u0,y:0},{x:u1,y:0},{x:u1,y:1},{x:u0,y:1}],spine:0,direction:1,pageWidth:16,binding:0,shade:0,gloss:0}}
test('lifted surface has no coverage gaps or texture seams between adjacent patches',()=>{const img=texture([255,40,20],[10,100,240]),whole=renderer(),split=renderer();whole.rasterFaces([quad(img)]);split.rasterFaces([quad(img,0,8,.2,0,.5),quad(img,8,16,.2,.5,1)]);assert.deepEqual(split.rasterImage.data,whole.rasterImage.data);for(let i=3;i<split.rasterImage.data.length;i+=4)assert.equal(split.rasterImage.data[i],255)});
test('near paper occludes the far surface regardless of patch ordering',()=>{const near=quad(texture([240,10,20]),0,16,.1),far=quad(texture([5,20,240]),0,16,.4);for(const order of [[near,far],[far,near]]){const r=renderer();r.rasterFaces(order);for(let i=0;i<r.rasterImage.data.length;i+=4)assert.deepEqual([...r.rasterImage.data.slice(i,i+4)],[240,10,20,255])}});
test('flat paper occludes curled patches without being repainted in the pixel layer',()=>{const r=renderer(),near=quad(texture([200,20,20]),0,8,.1,0,.5),far=quad(texture([10,20,240]),0,16,.4);r.rasterFaces([far],[near]);for(let y=0;y<16;y++)for(let x=0;x<16;x++){const i=(y*16+x)*4;assert.equal(r.rasterImage.data[i+3],x<8?0:255)}});

test('lifting a page never magnifies its uncurled surface or moves the spine',()=>{
 for(const single of [false,true]){const camera=createPaperCamera(400,560,12,single);for(const [x,y] of [[0,.7],[0,-.7],[1,.7],[1,-.7]]){const resting=new T.Vector3(x,y,0).project(camera);for(const z of [.009,.05,.24]){const raised=new T.Vector3(x,y,z).project(camera);assert.equal(raised.x,resting.x);assert.equal(raised.y,resting.y)}}
 for(const corner of [-1,1]){const spec=foldSpec(.075,1.4,corner,1.4*.19);for(const y of [-.7,0,.7]){const p=foldPoint(0,y,spec);assert.equal(p.x,0);assert.equal(p.y,y)}}}
});
test('neutral printed colors retain dark text and pastel contrast in the CPU renderer',()=>{
 for(const rgb of [[0,0,0],[18,18,18],[90,90,90],[128,128,128],[230,230,230],[250,240,220],[30,90,220],[255,255,255]]){const r=renderer();r.rasterFaces([quad(texture(rgb))]);for(let i=0;i<r.rasterImage.data.length;i+=4)assert.deepEqual([...r.rasterImage.data.slice(i,i+4)],[...rgb,255])}
});
test('GPU print layer bypasses ambient exposure while retaining fold and cast shadows',()=>{
 const f=Object.create(PageFlip.prototype);const m=f.material(new T.Texture());assert.equal(m.toneMapped,false);
 const shader={vertexShader:T.ShaderLib.physical.vertexShader,fragmentShader:T.ShaderLib.physical.fragmentShader};m.onBeforeCompile(shader);
 assert(shader.fragmentShader.includes('outgoingLight = diffuseColor.rgb * mix(1.0, getShadowMask(), 0.24)'));
 assert(shader.fragmentShader.indexOf('outgoingLight = diffuseColor.rgb')>shader.fragmentShader.indexOf('outgoingLight = totalDiffuse'));
 assert(shader.fragmentShader.includes('paperBend * 0.12'));assert(shader.vertexShader.includes('vPaperNormal = normal;'));m.dispose();
});
