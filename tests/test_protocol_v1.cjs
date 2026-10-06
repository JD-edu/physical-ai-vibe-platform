const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const catalog = fs.readFileSync('webapp/protocol-v1.js', 'utf8');
const app = fs.readFileSync('webapp/app.js', 'utf8').split('renderWidgets(); bindEvents();')[0];
async function run(state) {
  const requests=[], reports=[];
  const context={AbortSignal,Date,Math,setTimeout,structuredClone,localStorage:{getItem(){return null},setItem(){}},document:{querySelector(){return {innerHTML:'',value:''}}},fetch:async(url,options)=>{
    requests.push({url,options});
    return {ok:true,json:async()=>url.endsWith('/api/command')?{sent_count:1,state:'sent'}:{state,error:state==='failed'?'UNSUPPORTED_COMMAND':undefined}};
  }};
  vm.createContext(context);vm.runInContext(catalog+'\n'+app,context);
  context.network={bridgeUrl:'http://localhost:5000',protocol:'phyvibe-v1'};context.report=s=>reports.push(s);
  const execute=()=>vm.runInContext('deliverProtocolCommand(network,"a",report)',context);
  if(state==='acknowledged')assert.equal(await execute(),true);
  else await assert.rejects(execute,new RegExp(state));
  assert.equal(JSON.parse(requests[0].options.body).command,'a');
  assert.equal(JSON.parse(requests[0].options.body).protocol,'phyvibe-v1');
  assert(requests[1].url.includes('/api/commands/'));
  vm.runInContext('state.deviceProfile="microbit-v1-demo"',context);
  assert.throws(()=>vm.runInContext('normalizeWidgets([{id:"motor",type:"control",action:{skill:"set_motor"}}])',context),/unavailable/);
  assert.throws(()=>vm.runInContext('normalizeWidgets([{id:"b",type:"button",actions:[{skill:"send_text",text:"b"}]}])',context),/supported text commands/);
  vm.runInContext('state.deviceProfile="microbit-v1-servo"',context);
  assert.equal(vm.runInContext('normalizeWidgets([{id:"servo",type:"control",min:0,max:180,value:134,action:{skill:"set_servo",target:"servo"}}])[0].value',context),134);
  assert.throws(()=>vm.runInContext('normalizeWidgets([{id:"valve",type:"control",action:{skill:"set_servo",target:"valve"}}])',context),/supported servo targets/);
  assert.throws(()=>vm.runInContext('normalizeWidgets([{id:"motor",type:"control",action:{skill:"set_motor"}}])',context),/unavailable/);
}
(async()=>{for(const state of ['acknowledged','failed','timed_out','connection_lost'])await run(state);console.log('Protocol client passed: ACK success/failure/timeout/disconnect and device profile restrictions.');})().catch(e=>{console.error(e);process.exitCode=1});
