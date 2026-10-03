const fs = require('fs'), vm = require('vm'), assert = require('assert');
const source = fs.readFileSync('webapp/app.js','utf8').split('renderWidgets(); bindEvents();')[0];
async function test(saved, version, expected) {
  const storage = new Map(Object.entries({'phyvibe.provider':saved,'phyvibe.providerVersion':version}).filter(([,v])=>v));
  const nodes = new Map();
  const node = key => { if(!nodes.has(key)) nodes.set(key,{value:key==='#promptInput'?'Make a temperature dashboard':'',textContent:'',open:false,showModal(){this.open=true},classList:{remove(){}},querySelector(){return node('message')}}); return nodes.get(key); };
  const calls=[];
  const context={localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},structuredClone,URL,document:{querySelector:node},AbortSignal,setTimeout(){},clearTimeout(){},fetch:async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/v1/models'))return {ok:true,json:async()=>({data:[{id:'actual-qwen-model'}]})};
    return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({title:'Real model result',widgets:[{id:'temperature',type:'metric',value:25,action:{skill:'display_sensor',key:'temperature'}}]})}}]})};
  }};
  vm.createContext(context);vm.runInContext(source,context);
  vm.runInContext('appendMessage = () => document.querySelector("message"); renderWidgets = () => {}; toast = () => {};',context);
  assert.equal(vm.runInContext('state.provider',context),expected);
  await vm.runInContext('generate()',context);
  if(expected==='qwen') {
    assert.equal(calls.length,2);
    assert.equal(calls[0].url,'http://127.0.0.1:8080/v1/models');
    const request=calls[1];assert(request.url.endsWith('/v1/chat/completions'));
    const body=JSON.parse(request.options.body);
    assert.equal(body.model,'actual-qwen-model');assert.equal(body.messages[1].content,'Make a temperature dashboard');
    assert.equal(node('#dashboardTitle').textContent,'Real model result');
  } else assert.equal(calls.length,0);
  if(expected==='demo') {
    await vm.runInContext('configureQwenUrl("http://127.0.0.1:8081")',context);
    vm.runInContext('returnToLocalQwen()',context);
    await vm.runInContext('checkQwenConnection()',context);
    assert.equal(vm.runInContext('state.provider',context),'qwen');
    assert.equal(storage.get('phyvibe.provider'),'qwen');
    assert.equal(calls.length,1); // Button and generation share in-flight discovery.
    assert.equal(calls[0].url,'http://127.0.0.1:8081/v1/models');
    node('#promptInput').value='Recovered prompt';
    await vm.runInContext('generate()',context);
    assert.equal(calls[1].url,'http://127.0.0.1:8081/v1/chat/completions');
    await vm.runInContext('configureQwenUrl("http://127.0.0.1:8082")',context);
    assert.equal(vm.runInContext('state.qwenModelId',context),null);
  }
}
(async()=>{await test(null,null,'qwen');await test('demo',null,'qwen');await test('demo','2','demo');await test('openai','2','openai');console.log('Local LLM checks passed: new and legacy sessions call model discovery and generation; explicit demo stays offline; unsupported providers do not silently use demo.');})().catch(e=>{console.error(e);process.exitCode=1});
