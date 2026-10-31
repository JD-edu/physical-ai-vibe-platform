const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const nodes = new Map();
const node = key => { if (!nodes.has(key)) nodes.set(key, { value: '', innerHTML: '', textContent: '', classList: { add() {}, remove() {} }, addEventListener() {} }); return nodes.get(key); };
let plans = [], requests = [];
const context = { URL, AbortController, AbortSignal, structuredClone, setTimeout, clearTimeout, document: { querySelector: node }, localStorage: { getItem() { return null; }, setItem() {} }, fetch: async (_url, options) => {
  requests.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(plans.shift()) } }] }) };
} };
vm.createContext(context);
vm.runInContext(['skills.js', 'camera.js', 'vision.js', 'app.js'].map(f => fs.readFileSync(path.join(root, 'webapp', f), 'utf8')).join('\n').split(/renderWidgets\(\);\s*bindEvents\(\);/)[0], context);
const run = code => vm.runInContext(code, context);
const slider = id => ({ id, type: 'control', min: 0, max: 80, value: 50, action: { skill: 'set_motor' } });
const button = (direction, speedFrom = 'invented-speed') => ({ id: direction, type: 'button', actions: [{ skill: 'drive_motor', direction, speedFrom }] });
const prompt = '로봇을 전지후진 좌우회전 조종하는 버튼을 가진 리모트앱을 만들어 주세요. 모터의 속도는 슬라이드 버튼으로 셋팅하게 해주세요.';
const example = [slider('actual-speed'), ...['forward','backward','left','right','stop'].map(d => button(d))];
context.items = structuredClone(example);
context.widgets = run('normalizeWidgets(items, true)');
for (const w of context.widgets.filter(w => w.type === 'button' && w.id !== 'stop')) assert.equal(w.actions[0].speedFrom, 'actual-speed');
assert.equal(context.widgets.find(w => w.id === 'stop').actions[0].speed, 0);
assert.equal(context.widgets.find(w => w.id === 'stop').actions[0].speedFrom, undefined);
for (const speed of [0,23,73,80]) {
  context.widgets[0].value = speed;
  for (const direction of ['forward','backward','left','right','stop']) {
    context.actions = context.widgets.find(w => w.id === direction).actions;
    assert.equal(run('resolveButtonCommands(actions,widgets)[0]'), `CMD:motor:${direction}:${direction === 'stop' ? 0 : speed}`);
  }
}
context.prompt = prompt;
run('validateDrivePlan(widgets,prompt)');
context.items = [slider('one'), slider('two'), button('forward')];
assert.throws(() => run('normalizeWidgets(items,true)'), /Available motor slider IDs: one, two/);
context.items = [button('forward')];
assert.throws(() => run('normalizeWidgets(items,true)'), /none; add a control/);
context.items = [slider('speed'), {id:'servo',type:'control',action:{skill:'set_servo',target:'servo'}}, button('forward','servo')];
assert.throws(() => run('normalizeWidgets(items,true)'), /Available motor slider IDs: speed/);
context.items = [slider('one'), slider('two'), button('forward','two')];
assert.equal(run('normalizeWidgets(items,true)[2].actions[0].speedFrom'),'two');
context.items = [slider('speed'),{id:'forward',type:'button',actions:[{skill:'drive_motor',direction:'forward',speed:0}]}];
assert.equal(run('normalizeWidgets(items,true)[1].actions[0].speedFrom'),'speed');
context.items = ['forward','backward','left','right'].map(direction => ({id:direction,type:'button',actions:[{skill:'drive_motor',direction,speed:50}]}));
assert.throws(() => run('validateDrivePlan(normalizeWidgets(items,true),prompt)'), /slider requested/);
context.items = structuredClone(example).filter(w => w.id !== 'left');
assert.throws(() => run('validateDrivePlan(normalizeWidgets(items,true),prompt)'), /Requested left/);
// The same command resolver is included verbatim in standalone exports.
const exported = { actions: context.widgets[1].actions, widgets: context.widgets };
vm.createContext(exported);vm.runInContext(run('resolveButtonCommands.toString()'), exported);
assert.equal(vm.runInContext('resolveButtonCommands(actions,widgets)[0]',exported),'CMD:motor:forward:80');
(async()=>{
  run('state.qwenModelId="mock"');
  plans=[{widgets:structuredClone(example)}];
  const generated = await run('generateWithQwen(prompt)');
  assert.equal(generated.widgets.length,6);
  assert.equal(requests.length,1,'Unambiguous ID typo should not need another LLM request');
  assert(requests[0].messages[0].content.includes('Complete robot remote example'));
  plans=[{widgets:[button('forward')]},{widgets:structuredClone(example)}];
  assert.equal((await run('generateWithQwen(prompt)')).widgets.length,6);
  assert(requests.at(-1).messages.at(-1).content.includes('add a control widget'));
  if(process.env.REAL_QWEN==='1') {
    const base=process.env.QWEN_TEST_URL||'http://127.0.0.1:8080';
    const response=await fetch(base+'/v1/models',{signal:AbortSignal.timeout(5000)});
    assert(response.ok);const model=(await response.json()).data[0].id;
    context.fetch=fetch;context.base=base;context.model=model;
    run('QWEN_BASE_URL=base;state.qwenModelId=model');
    const actual=await run('generateWithQwen(prompt)');
    const speed=actual.widgets.filter(w=>w.type==='control'&&w.action?.skill==='set_motor');
    assert.equal(speed.length,1);
    context.widgets=actual.widgets;
    for(const value of [25,73]){
      speed[0].value=value;
      for(const direction of ['forward','backward','left','right']){
        const action=actual.widgets.flatMap(w=>w.actions||[]).find(a=>a.direction===direction);
        assert(action,'Missing '+direction);assert.equal(action.speedFrom,speed[0].id);context.actions=[action];
        assert.equal(run('resolveButtonCommands(actions,widgets)[0]'),`CMD:motor:${direction}:${value}`);
      }
    }
    console.log('PASS: real local Qwen generated the original Korean request; one slider drives four direction buttons at 25/73.');
  }
  console.log('PASS: single-slider ID repair, stop=0, zero initial speed, missing/ambiguous/wrong-type references rejected, current speed in exports, correction request.');
})().catch(error=>{console.error(error);process.exitCode=1;});
