// Run: node camera/tests/browser.cjs. Requires Chrome and Node's ws package.
// Camera pixels/networking and DOM are real; CNN dependencies are mocked for deterministic offline tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const {spawn, execFileSync} = require('node:child_process');
const WebSocket = require('ws');
const root = path.resolve(__dirname, '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phyvibe-camera-'));
let chrome, ws, studio, camera;
const sockets = new Set();
let exported = '', cameraCount = 0, cameraActive = 0, dropOnce = false;
const deliveredCommands=[];
function serve(handler) {
 const server = http.createServer(handler);
 server.on('connection', s => {sockets.add(s);s.on('close',()=>sockets.delete(s));});
 return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server)));
}
const delay = ms => new Promise(r=>setTimeout(r,ms));
(async()=>{
 // Generate a valid colored JPEG without test fixture downloads.
 const jpeg = execFileSync('python3',['-c',"import cv2,numpy as np,sys;ok,jpg=cv2.imencode('.jpg',np.full((240,320,3),(20,80,210),dtype=np.uint8));assert ok;sys.stdout.buffer.write(jpg.tobytes())"]);
 camera = await serve((req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Private-Network','true');
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  if(req.url==='/stall'){res.writeHead(200,{'Content-Type':'multipart/x-mixed-replace; boundary=frame'});res.flushHeaders();return;}
  if(req.url!=='/stream'){res.writeHead(404);return res.end();}
  cameraCount++;cameraActive++;
  res.writeHead(200,{'Content-Type':'multipart/x-mixed-replace; boundary=frame','Cache-Control':'no-store'});
  const part=Buffer.concat([Buffer.from(`\r\n--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`),jpeg]);
  let fragmentTimer;
  function frame(){if(dropOnce){dropOnce=false;res.destroy();return;}res.write(part.subarray(0,part.length-1));fragmentTimer=setTimeout(()=>res.write(part.subarray(part.length-1)),5);}
  frame();const timer=setInterval(frame,100);
  req.on('close',()=>{clearInterval(timer);clearTimeout(fragmentTimer);cameraActive--;});
 });
 const cameraURL=`http://127.0.0.1:${camera.address().port}/stream`;
 studio = await serve((req,res)=>{
  if(req.url==='/api/status'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({connected_clients:1,message_sequence:0,message_history:[]}));}
  if(req.url==='/api/command'){let body='';req.on('data',data=>body+=data);req.on('end',()=>{deliveredCommands.push(JSON.parse(body).command);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({sent_count:1}));});return;}
  if(req.url==='/export.html'){res.setHeader('Content-Type','text/html');return res.end(exported);}
  const file=path.join(root,new URL(req.url,'http://local').pathname);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));
 });
 const origin=`http://127.0.0.1:${studio.address().port}`;
 chrome = spawn(process.env.CHROME_BIN || '/usr/bin/google-chrome',['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${tmp}`,'--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','about:blank'],{stdio:['ignore','ignore','pipe']});
 let stderr='';const address=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Chrome startup timed out: '+stderr)),15000);
  chrome.on('error',reject);chrome.on('exit',()=>{clearTimeout(timer);reject(Error(stderr));});
  chrome.stderr.on('data',d=>{stderr+=d;const match=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
 });
 ws=new WebSocket(address);await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
 let id=0;const pending=new Map();
 ws.on('message',data=>{const m=JSON.parse(data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
 function cdp(method,params={},sessionId){return new Promise((resolve,reject)=>{const request=++id;const timer=setTimeout(()=>{pending.delete(request);reject(Error('CDP timeout '+method));},20000);pending.set(request,{resolve,reject,timer});ws.send(JSON.stringify({id:request,method,params,...(sessionId?{sessionId}:{})}));});}
 const {targetId}=await cdp('Target.createTarget',{url:origin+'/webapp/index.html'});
 const {sessionId}=await cdp('Target.attachToTarget',{targetId,flatten:true});
 await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sessionId);
 async function evaluate(expression){const out=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(out.exceptionDetails)throw Error(out.exceptionDetails.exception?.description||JSON.stringify(out.exceptionDetails));return out.result.value;}
 async function wait(expression,timeout=10000){for(let i=0;i<timeout/100;i++){if(await evaluate(expression))return;await delay(100);}throw Error('Wait failed: '+expression);}
 await wait('typeof createEsp32FrameSource === "function" && typeof renderStudioCamera === "function"');
 assert.equal(await evaluate(`document.querySelector('#esp32CameraPanel').open`),true,'Editor camera window must be visible by default');
 await evaluate(`state.provider='demo';clearTimeout(qwenRetryTimer);document.querySelectorAll('dialog').forEach(d=>d.close());state.cameraUrl=${JSON.stringify(cameraURL)};renderStudioCamera();document.querySelector('#esp32CameraPanel').open=true;`);
 await delay(100);
 await evaluate(`document.querySelector('#esp32CameraPreview [data-vision="start"]').click()`);
 await wait(`document.querySelector('#esp32CameraPreview .vision-progress').textContent.includes('연결 완료')`);
 assert.equal(await evaluate(`document.querySelector('#esp32CameraPreview canvas').width`),320);
 assert((await evaluate(`Array.from(document.querySelector('#esp32CameraPreview canvas').getContext('2d').getImageData(0,0,1,1).data)`))[0]>150);
 assert.equal(await evaluate(`document.querySelectorAll('script[src*="tensorflow"]').length`),0,'Preview must not download CNN');
 const previewShot=await cdp('Page.captureScreenshot',{format:'png'},sessionId);fs.writeFileSync('/tmp/phyvibe-editor-camera.png',Buffer.from(previewShot.data,'base64'));
 await evaluate(`(async()=>{const c=document.createElement('canvas');const source=createEsp32FrameSource(c,()=>{});let rejected=false;try{await source.start(${JSON.stringify(cameraURL.replace('/stream','/missing'))})}catch{rejected=true}if(!rejected||source.ready||source.active)throw Error('HTTP error lifecycle failed');const pending=source.start(${JSON.stringify(cameraURL.replace('/stream','/stall'))}).then(()=>false,()=>true);setTimeout(()=>source.stop(),50);if(!await pending)throw Error('In-flight cancellation failed')})()`);
 const before=cameraCount;await evaluate('renderStudioCamera();renderStudioCamera()');await delay(200);assert.equal(cameraCount,before,'Rerender must retain source');
 dropOnce=true;
 await wait(`document.querySelector('#esp32CameraPreview .vision-progress').textContent.includes('자동 재연결됨')`);
 assert.equal(cameraActive,1);assert(cameraCount>before,'Dropped stream must reconnect automatically');
 await evaluate('document.querySelector("#esp32CameraPanel").open=false');await wait('true');await delay(300);assert.equal(cameraActive,0,'Closing preview must release stream');
 await evaluate('document.querySelector("#esp32CameraPanel").open=true');await delay(100);
 await evaluate(`document.querySelector('#esp32CameraPreview [data-vision="start"]').click()`);
 await wait(`document.querySelector('#esp32CameraPreview .vision-progress').textContent.includes('연결 완료')`);
 await evaluate(`state.widgets=compileAppIntent({version:1,title:'카메라',features:[{kind:'camera'}]},appIntentContext('',state.cameraUrl),SKILL_CATALOG.profiles.esp32).widgets;renderWidgets();document.querySelector('#widgetGrid [data-vision="start"]').click()`);
 await wait(`document.querySelector('#widgetGrid .vision-progress').textContent.includes('연결 완료')`);
 await wait(`document.querySelector('#esp32CameraPreview .vision-connection').textContent.includes('다른 창')`);
 assert.equal(cameraActive,1,'Moving camera to generated widget must keep only one connection');
 await evaluate(`document.querySelector('#widgetGrid [data-vision="stop"]').click();document.querySelector('#esp32CameraPanel').open=false`);await delay(250);
 assert.equal(cameraActive,0);
 const stub=`globalThis.modelCalls={infer:0,fit:0,disposed:0};const tensor=(shape=[1,4])=>({shape,dispose(){modelCalls.disposed++}});const mockHead=()=>({inputs:[{shape:[null,4]}],outputs:[{shape:[null,2]}],add(){},compile(){},async fit(xs,ys,options){modelCalls.fit++;await options.callbacks.onEpochEnd(0,{loss:0.1})},predict:()=>({dataSync:()=>[0.95,0.05]}),async save(handler){return handler({modelTopology:{mock:true},weightSpecs:[],weightData:new ArrayBuffer(4)})},dispose(){}});globalThis.tf={io:{withSaveHandler:f=>f,fromMemory:x=>x},loadLayersModel:async()=>mockHead(),ready:async()=>{},tidy:f=>f(),nextFrame:async()=>{},concat:rows=>tensor([rows.length,4]),tensor1d:()=>tensor(),oneHot:()=>tensor(),layers:{dense:x=>x},sequential:()=>mockHead()};globalThis.mobilenet={load:async()=>({infer(input){if(input.width!==224||input.height!==224)throw Error('Wrong CNN dimensions');input.getContext('2d').getImageData(0,0,1,1);modelCalls.infer++;return tensor()},model:{dispose(){}}})};`;
 await evaluate(stub);
 await evaluate(`state.widgets=compileAppIntent({version:1,title:'CNN',features:[{kind:'classifier',classes:['object','empty']}]},appIntentContext('',state.cameraUrl),SKILL_CATALOG.profiles.esp32).widgets;state.generationValid=true;renderWidgets();document.querySelector('#widgetGrid [data-vision="start"]').click();`);
 await wait(`document.querySelector('#widgetGrid .vision-progress').textContent.includes('준비 완료')`);
 for(const label of [0,1]){await evaluate(`document.querySelector('#widgetGrid [data-vision="sample"][data-class="${label}"]').click()`);await wait(`document.querySelector('#widgetGrid [data-count="${label}"]').textContent==='5장' && !document.querySelector('#widgetGrid [data-vision="reset"]').disabled`);}
 assert.equal(await evaluate('modelCalls.infer'),10);
 await evaluate(`document.querySelector('#widgetGrid [data-vision="train"]').click()`);
 await wait(`document.querySelector('#widgetGrid .vision-progress').textContent.includes('학습 완료')`);
 await evaluate(`document.querySelector('#widgetGrid [data-vision="predict"]').click()`);
 await wait(`document.querySelector('#widgetGrid .vision-result').textContent.includes('object')`);
 await evaluate(`document.querySelector('#widgetGrid [data-vision="live"]').click()`);await delay(1200);assert((await evaluate('modelCalls.infer'))>=13);await evaluate(`document.querySelector('#widgetGrid [data-vision="live"]').click()`);
 const shot=await cdp('Page.captureScreenshot',{format:'png'},sessionId);fs.writeFileSync(path.join(tmp,'cnn-preview.png'),Buffer.from(shot.data,'base64'));
 await evaluate(`document.querySelector('#widgetGrid [data-vision="stop"]').click()`);await delay(300);assert.equal(cameraActive,0);
 // Export through the real app path, then load the resulting standalone HTML.
 exported=await evaluate(`(async()=>{let saved;const old=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;URL.createObjectURL=b=>{saved=b;return 'blob:test'};HTMLAnchorElement.prototype.click=()=>{};try{await downloadProject()}finally{URL.createObjectURL=old;HTMLAnchorElement.prototype.click=click}return await saved.text()})()`);
 assert(exported.includes('function createEsp32FrameSource'));assert(exported.includes(cameraURL));
 await cdp('Page.navigate',{url:origin+'/export.html'},sessionId);
 await wait('typeof userAppRuntime === "function" && !!document.querySelector("[data-vision=start]")');
 await evaluate(stub);
 await evaluate(`document.querySelector('[data-vision="start"]').click()`);
 await wait(`document.querySelector('.vision-progress').textContent.includes('준비 완료')`);
 assert.equal(await evaluate(`document.querySelector('canvas').getContext('2d').getImageData(0,0,1,1).data[0]>150`),true);
 await evaluate(`document.querySelector('[data-vision="predict"]').click()`);await wait(`document.querySelector('.vision-result').textContent.includes('object')`);assert.equal(await evaluate('modelCalls.fit'),0);
 await evaluate(`document.querySelector('[data-vision="stop"]').click()`);await delay(300);assert.equal(cameraActive,0);
 if(process.env.REAL_CNN==='1'){
  function setExportedModels(models) {
    const match=exported.match(/const dashboardProject = ([\s\S]*?);\s*\/\/ Start the dashboard/);
    assert(match,'Standalone configuration must exist');
    const project=JSON.parse(match[1]);project.visionModels=models;
    exported=exported.replace(match[1],JSON.stringify(project,null,2));
  }
  setExportedModels({});
  exported=exported.replace('const vision = createVisionRuntime(send, project.visionModels || {});','const vision = globalThis.testVision = createVisionRuntime(send, project.visionModels || {});');
  await cdp('Page.navigate',{url:origin+'/export.html'},sessionId);
  await wait('typeof userAppRuntime === "function" && !!document.querySelector("[data-vision=start]")');
  await evaluate(`document.querySelector('[data-vision="start"]').click()`);
  let modelReady=false;for(let i=0;i<600;i++){const status=await evaluate(`document.querySelector('.vision-progress').textContent`);if(status.includes('준비 완료')){modelReady=true;break;}if(status.includes('실패')||status.includes('Failed'))throw Error('Real CNN load failed: '+status);await delay(100);}
  assert(modelReady,'Real MobileNet load timed out');
  for(const label of [0,1]){await evaluate(`document.querySelector('[data-vision="sample"][data-class="${label}"]').click()`);await wait(`document.querySelector('[data-count="${label}"]').textContent==='5장' && !document.querySelector('[data-vision="reset"]').disabled`);}
  await evaluate(`document.querySelector('[data-vision="train"]').click()`);await wait(`document.querySelector('.vision-progress').textContent.includes('학습 완료')`);
  await evaluate(`document.querySelector('[data-vision="predict"]').click()`);await wait(`/인식|불확실/.test(document.querySelector('.vision-result').textContent)`);
  await evaluate(`document.querySelector('[data-vision="stop"]').click()`);
  const savedModels=await evaluate('testVision.exportModels()');
  assert(savedModels['feature-1'].weightData.length>100,'Export must include real trained weights');
  setExportedModels(savedModels);
  await cdp('Page.navigate',{url:origin+'/export.html'},sessionId);
  await wait('!!document.querySelector("[data-vision=start]")');
  await evaluate(`document.querySelector('[data-vision="start"]').click()`);
  await wait(`document.querySelector('.vision-progress').textContent.includes('저장된 분류기 준비 완료')`,60000);
  assert.equal(await evaluate(`document.querySelector('[data-count="0"]').textContent`),'0장');
  await evaluate(`document.querySelector('[data-vision="predict"]').click()`);
  await wait(`/인식|불확실/.test(document.querySelector('.vision-result').textContent)`);
  await evaluate(`document.querySelector('[data-vision="stop"]').click()`);
  console.log('PASS: real TensorFlow.js + MobileNet CNN training, HTML weight export and restored inference without samples or retraining.');
  setExportedModels({});
 }
 // Original webcam input still works in an exported application.
 exported=exported.replaceAll('"type": "esp32_stream"','"type": "webcam"');
 await cdp('Page.navigate',{url:origin+'/export.html'},sessionId);
 await wait('typeof userAppRuntime === "function" && !!document.querySelector("[data-vision=start]")');
 await evaluate(stub);await evaluate(`document.querySelector('[data-vision="start"]').click()`);
 await wait(`document.querySelector('.vision-progress').textContent.includes('준비 완료')`);
 assert.equal(await evaluate(`document.querySelector('video').videoWidth>0 && document.querySelector('canvas').hidden`),true);
 await evaluate(`document.querySelector('[data-vision="stop"]').click()`);
 console.log('PASS: existing PC webcam path in standalone HTML.');
 // Compile and export a camera remote, then exercise its real controls against a mock bridge.
 await cdp('Page.navigate',{url:origin+'/webapp/index.html'},sessionId);
 await wait('typeof compileAppIntent === "function" && typeof downloadProject === "function"');
 await evaluate(`state.provider='demo';clearTimeout(qwenRetryTimer);document.querySelectorAll('dialog').forEach(d=>d.close());state.cameraUrl=${JSON.stringify(cameraURL)};state.bridgeUrl=${JSON.stringify(origin)};state.widgets=compileAppIntent({version:1,title:'카메라 리모컨',features:[{kind:'camera'},{kind:'motor',speedControl:'slider',directions:['forward','backward','left','right','stop']}]},appIntentContext('',state.cameraUrl),SKILL_CATALOG.profiles.esp32).widgets;state.generationValid=true;renderWidgets();`);
 exported=await evaluate(`(async()=>{let saved;const old=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;URL.createObjectURL=b=>{saved=b;return 'blob:test'};HTMLAnchorElement.prototype.click=()=>{};try{await downloadProject()}finally{URL.createObjectURL=old;HTMLAnchorElement.prototype.click=click}return await saved.text()})()`);
 assert(!exported.includes('function compileAppIntent'),'Standalone must not depend on compiler or LLM');
 await cdp('Page.navigate',{url:origin+'/export.html'},sessionId);
 await wait(`document.querySelectorAll('#widgetGrid .widget').length===7`);
 await evaluate(`document.querySelector('[data-vision="start"]').click();document.querySelector('#connect').click()`);
 await wait(`document.querySelector('.vision-progress').textContent.includes('연결 완료') && document.querySelector('#status').textContent.includes('서버 연결 완료')`);
 for(const speed of [0,27,80])for(const direction of ['forward','backward','left','right','stop']){
   const previous=deliveredCommands.length;
   await evaluate(`(()=>{const slider=document.querySelector('[data-control]');slider.value=${speed};slider.dispatchEvent(new Event('input',{bubbles:true}));const button=[...document.querySelectorAll('[data-actions]')].find(b=>JSON.parse(b.dataset.actions)[0].direction===${JSON.stringify(direction)});button.click()})()`);
   for(let i=0;i<100&&deliveredCommands.length===previous;i++)await delay(50);
   assert.equal(deliveredCommands.at(-1),`CMD:motor:${direction}:${direction==='stop'?0:speed}`);
 }
 await evaluate(`document.querySelector('[data-vision="stop"]').click();document.querySelector('#disconnect').click()`);
 console.log('PASS: compiled standalone camera remote, 7 widgets, direct video plus mock bridge; slider 0/27/80 drives four directions and stop=0 without editor/LLM/compiler.');

 console.log('Screenshot: '+path.join(tmp,'cnn-preview.png'));
 console.log('PASS: real Chrome cross-origin fragmented MJPEG -> readable canvas, editor preview lifecycle, no relay/model for preview, mocked CNN sampling/training/prediction/live inference, standalone HTML direct camera, cleanup.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
 ws?.close();chrome?.kill();for(const s of sockets)s.destroy();await Promise.all([studio,camera].filter(Boolean).map(s=>new Promise(r=>s.close(r))));
 // Chrome may still be releasing its temporary profile; keep it in the OS temp directory.
});
