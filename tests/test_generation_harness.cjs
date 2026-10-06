const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=(fs.readFileSync('webapp/protocol-v1.js','utf8') + '\n' + fs.readFileSync('webapp/app.js','utf8')).split('renderWidgets(); bindEvents();')[0];
const valid={title:'Send a',widgets:[{id:'send-a',type:'button',title:'Send a',actions:[{skill:'send_text',text:'a'}]}]};
const invalid={title:'Broken',widgets:[{id:'button',type:'control',value:0}]};
function setup(responses=[], protocolState="acknowledged") {
 const nodes=new Map(),requests=[],events={};
 const node=key=>{if(!nodes.has(key))nodes.set(key,{value:'',textContent:'',innerHTML:'',classList:{remove(){},add(){}},addEventListener(type,fn){events[key+':'+type]=fn;}});return nodes.get(key);};
 const context={document:{querySelector:node},localStorage:{getItem(){return null},setItem(){}},URL,structuredClone,AbortController,AbortSignal,setTimeout(){},clearTimeout(){},fetch:async(url,opts)=>{
 requests.push({url,opts});
 if(url.endsWith('/api/status'))return {ok:true,json:async()=>({connected_clients:1,message_history:[],message_sequence:0})};
 if(url.includes('/api/commands/'))return {ok:true,json:async()=>({state:protocolState,error:protocolState==='failed'?'UNSUPPORTED_COMMAND':undefined})};
 if(url.endsWith('/api/command'))return {ok:true,json:async()=>({sent_count:1})};
 return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(responses.shift())}}]})};
 }};vm.createContext(context);vm.runInContext(source,context);vm.runInContext('state.qwenModelId="qwen"',context);return {context,node,requests,events};
}
(async()=>{
 const t=setup([invalid,valid]);
 const result=await vm.runInContext('generateWithQwen("Make a button that sends a")',t.context);
 assert.equal(result.widgets[0].actions[0].text,'a');
 t.context.alias={id:'send-a',type:'button',action:{skills:[{skill:'send_text',text:'a'}]}};
 assert.equal(vm.runInContext('normalizeWidgets([alias])[0].actions[0].text',t.context),'a');assert.equal(t.requests.length,2);
 assert(JSON.parse(t.requests[1].opts.body).messages[3].content.includes('failed validation'));
 const markup=vm.runInContext('renderWidget(normalizeWidgets([{id:"send-a",type:"button",title:"Send a",actions:[{skill:"send_text",text:"a"}]}])[0])',t.context);
 assert(markup.includes('data-commands="[&quot;a&quot;]"'));assert(!markup.includes('type="range"'));assert(!markup.includes('CMD:send-a'));
 for(const action of [{skill:'execute_code',text:'a'},{skill:'send_text',text:'a\nb'}]) {
 t.context.bad=action;assert.throws(()=>vm.runInContext('normalizeWidgets([{id:"bad",type:"button",actions:[bad]}])',t.context));
 }
 t.context.project={network:{bridgeUrl:'http://localhost:5000'},widgets:result.widgets};
 vm.runInContext('userAppRuntime(project)',t.context);
 t.node('#connect').onclick();await new Promise(setImmediate);
 t.events['#widgetGrid:click']({target:{dataset:{commands:'["a"]'}}});await new Promise(setImmediate);
 const sent=t.requests.filter(r=>r.url.endsWith('/api/command'));
 assert.equal(sent.length,1);assert.equal(JSON.parse(sent[0].opts.body).command,'a');
 // Multiple allowed actions run in order, preserving text exactly.
 t.events['#widgetGrid:click']({target:{dataset:{commands:'[" A ","CMD:servo:999"]'}}});await new Promise(setImmediate);
 const sequence=t.requests.filter(r=>r.url.endsWith('/api/command')).slice(-2).map(r=>JSON.parse(r.opts.body).command);
 assert.deepEqual(sequence,[' A ','CMD:servo:999']);
 // Export runtime uses the same ACK contract and stops sequences on device failure.
 for (const finalState of ['acknowledged','failed']) {
  const v1=setup([],finalState);
  v1.context.project={network:{bridgeUrl:'http://localhost:5000',protocol:'phyvibe-v1'},widgets:result.widgets};
  vm.runInContext('userAppRuntime(project)',v1.context);
  v1.node('#connect').onclick();await new Promise(setImmediate);
  v1.events['#widgetGrid:click']({target:{dataset:{commands:'["a","a"]'}}});await new Promise(setImmediate);
  const posts=v1.requests.filter(r=>r.url.endsWith('/api/command'));
  assert.equal(posts.length,finalState==='acknowledged'?2:1);
  assert.equal(JSON.parse(posts[0].opts.body).protocol,'phyvibe-v1');
  assert.equal(JSON.parse(posts[0].opts.body).command,'a');
  assert(v1.requests.some(r=>r.url.includes('/api/commands/')));
  assert(v1.node('#monitor').textContent.includes(finalState==='acknowledged'?'ACK':'UNSUPPORTED_COMMAND'));
 }
 const broken=setup([invalid,invalid]);await assert.rejects(()=>vm.runInContext('generateWithQwen("a")',broken.context),/하네스 검증 실패/);assert.equal(broken.requests.length,2);
 console.log('Harness checks passed: correction request, invalid skill rejection, literal button rendering, exported click sends exactly a, ordered literal actions, v1 export ACK handling, failure stops sequence, bounded retry.');
})().catch(e=>{console.error(e);process.exitCode=1});
