// A deliberately slow decoder must skip queued frames instead of replaying them.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let input,closed=0,fetches=0;
const drawn=[];
const ctx={URL,Blob,AbortController,Uint8Array,Date,setTimeout,clearTimeout,
 fetch:async(_url,{signal})=>(fetches++,{ok:true,headers:{get:()=> 'multipart/x-mixed-replace; boundary=frame'},body:new ReadableStream({start(controller){input=controller;signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true})}})}),
 createImageBitmap:async blob=>{const bytes=new Uint8Array(await blob.arrayBuffer());const id=bytes[2];await pause(30);if(id===250)throw Error("Bad JPEG");return {width:320,height:240,id,close(){closed++}}}
};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../../webapp/camera.js'),'utf8'),ctx);
const canvas={width:0,height:0,getContext:()=>({clearRect(){},drawImage(image){drawn.push(image.id)}})};
ctx.canvas=canvas;ctx.update=()=>{};
const source=vm.runInContext('createEsp32FrameSource(canvas,update)',ctx);
const jpeg=id=>Uint8Array.from([255,216,id,255,217]);
(async()=>{
 const ready=source.start('http://camera/stream');await pause(1);input.enqueue(jpeg(1));await pause(5);
 const burst=Uint8Array.from(Array.from({length:9},(_,i)=>Array.from(jpeg(i+2))).flat());input.enqueue(burst);
 await ready;await pause(75);
 assert.deepEqual(drawn,[1,10]);assert.equal(canvas.width,320);assert.equal(canvas.height,240);assert(source.ready);
 input.enqueue(jpeg(11));await pause(5);source.stop();await pause(45);
 assert.deepEqual(drawn,[1,10],'In-flight decoding cannot render after stop');assert(!source.ready);assert.equal(closed,3);
 const cancelled=source.start('http://camera/stream');await pause(1);source.stop();await assert.rejects(()=>cancelled);
 const events=[];ctx.update=(error,info)=>events.push(info);const retrySource=vm.runInContext('createEsp32FrameSource(canvas,update)',ctx);
 const initial=retrySource.start('http://camera/retry');await pause(1);input.enqueue(jpeg(20));await initial;
 input.close();await pause(15);assert(retrySource.active);assert(!retrySource.ready);assert(events.some(e=>e.state==='retrying'));
 await pause(1050);input.enqueue(jpeg(21));await pause(45);assert(retrySource.ready);assert(events.some(e=>e.resumed));
 const handoff=vm.runInContext('createEsp32FrameSource(canvas,update)',ctx);const transferred=handoff.start('http://camera/retry');await pause(1);input.enqueue(jpeg(22));await transferred;
 assert(!retrySource.active);assert(events.some(e=>e.state==='paused'));
 const connections=fetches;input.enqueue(jpeg(250));await pause(40);input.enqueue(jpeg(23));await pause(40);assert(handoff.ready);assert.equal(fetches,connections,'One bad JPEG must not reconnect');
 input.close();await pause(10);handoff.stop();await pause(1100);assert.equal(fetches,connections,'Manual stop must cancel retry timer');
 console.log('PASS: reconnect after stream loss, same-page ownership transfer, isolated invalid JPEG tolerated, manual stop cancels retry.');
 console.log('PASS: slow browser decoder skips frames 2..9, renders latest #10 at 320x240, releases bitmaps, cancels in-flight frames.');
})().catch(error=>{console.error(error);process.exitCode=1});
