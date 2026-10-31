const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), path = require('node:path');
const root = path.resolve(__dirname, '../..');
const nodes = new Map();
const node = key => { if (!nodes.has(key)) nodes.set(key, { value: '', textContent: '', innerHTML: '', classList: { add() {}, remove() {} }, addEventListener() {} }); return nodes.get(key); };
let plans = [], requests = [];
const context = { URL, AbortController, AbortSignal, structuredClone, setTimeout, clearTimeout,
  document: { querySelector: node }, localStorage: { getItem() { return null; }, setItem() {} },
  fetch: async (_url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(plans.shift()) } }] }) }; }
};
vm.createContext(context);
vm.runInContext(['skills.js', 'camera.js', 'vision.js', 'app.js'].map(f => fs.readFileSync(path.join(root, 'webapp', f), 'utf8')).join('\n').split(/renderWidgets\(\);\s*bindEvents\(\);/)[0], context);
const run = code => vm.runInContext(code, context);
assert.equal(run('requestedCameraSource("ESP32 모터 전진 버튼")'), null);
const classifier = source => ({ id: 'camera', type: 'classifier', action: { skill: 'image_classifier', classes: ['object', 'empty'], rules: [], ...(source ? { source } : {}) } });
const source = { type: 'esp32_stream', url: 'http://192.168.0.123/stream' };
context.item = classifier(source);
assert.equal(run('normalizeWidgets([item])[0].action.source.url'), source.url);
context.item = classifier();
assert.equal(run('normalizeWidgets([item])[0].action.source.type'), 'webcam');
for (const invalid of [ { type: 'unknown' }, { type: 'esp32_stream', url: 'javascript:alert(1)' }, { type: 'esp32_stream', url: 'http://user:password@camera/stream' }, { type: 'esp32_stream', url: 'http://camera/stream#x' }, { type: 'esp32_stream', url: 123 } ]) {
  context.input = invalid; assert.throws(() => run('normalizeVisionSource(input)'));
}
context.input = { type: 'esp32_stream', url: '' };
assert.equal(run('normalizeVisionSource(input).url'), '');
context.item = { id: 'preview', type: 'camera_stream', action: { skill: 'camera_stream', source } };
assert.equal(run('normalizeWidgets([item])[0].type'), 'camera_stream');
const markup = run('renderVisionWidget(normalizeWidgets([item])[0])');
assert(markup.includes('data-esp32-preview')); assert(!markup.includes('data-vision="train"'));
context.item = classifier(source);
const cnn = run('renderVisionWidget(normalizeWidgets([item])[0])');
assert(cnn.includes('data-vision="train"')); assert(cnn.includes('data-vision="live"'));
(async () => {
  run(`state.qwenModelId='test';state.cameraUrl=${JSON.stringify(source.url)}`);
  plans = [{ widgets: [classifier({ type: 'webcam' })] }, { widgets: [classifier(source)] }];
  const result = await run('generateWithQwen("ESP32 카메라 영상 CNN 분류 웹앱")');
  assert.equal(requests.length, 2); assert.equal(result.widgets[0].action.source.url, source.url);
  assert(requests[0].messages[0].content.includes('NEVER create a PC video relay'));
  assert(requests[1].messages.at(-1).content.includes('failed validation'));
  plans = [{ widgets: [classifier({ type: 'esp32_stream', url: 'http://invented/stream' })] }, { widgets: [classifier({ type: 'esp32_stream', url: 'http://invented/stream' })] }];
  await assert.rejects(() => run('generateWithQwen("ESP32 카메라 분류")'), /검증 실패/);
  plans = [{ widgets: [{ id: 'only-preview', type: 'camera_stream', action: { skill: 'camera_stream', source } }] }, { widgets: [classifier(source)] }];
  const corrected = await run('generateWithQwen("ESP32 카메라 CNN 학습")');
  assert.equal(corrected.widgets[0].type, 'classifier');
  plans = [{ widgets: [{ id: 'preview', type: 'camera_stream', action: { skill: 'camera_stream', source } }] }];
  assert.equal((await run('generateWithQwen("ESP32 카메라 영상만 표시")')).widgets[0].type, 'camera_stream');
  assert.equal(run('requestedCameraSource("이 카메라와 CNN으로 양품 불량 분류")').url, source.url);
  assert.equal(run('requestedCameraSource("PC 웹캠 CNN 분류")').type, 'webcam');
  context.item = classifier(source);
  context.item.action.rules = [{label:'object',skill:'drive_motor',direction:'forward',speed:35},{label:'empty',skill:'drive_motor',direction:'stop',speed:50}];
  context.widgets = run('normalizeWidgets([item])');
  assert.equal(context.widgets[0].action.rules[0].text,'CMD:motor:forward:35');
  assert.equal(context.widgets[0].action.rules[1].text,'CMD:motor:stop:0');
  run('validateDrivePlan(widgets,"카메라 CNN 물체가 있으면 모터 전진, 없으면 정지")');
  assert.throws(()=>run('validateCameraPlan(widgets,"이 카메라 YOLO 객체 검출", requestedCameraSource("이 카메라 YOLO 객체 검출"))'),/아직 지원/);
  context.item.action.rules = [{label:'object',skill:'set_servo',target:'servo',angle:90}];
  assert.equal(run('normalizeWidgets([item])[0].action.rules[0].text'),'CMD:servo:90');
  context.item.action.rules[0].angle=181;
  assert.throws(()=>run('normalizeWidgets([item])'),/0..180/);
  context.item.action.rules = [{label:'object',skill:'drive_motor',direction:'forward',speed:81}];
  assert.throws(()=>run('normalizeWidgets([item])'),/0..80/);

  assert.throws(()=>run('normalizeVisionWidget(item, {skills:["send_text"]})'),/unavailable/);
  run('state.deviceProfile="legacy"');
  if (process.env.REAL_QWEN === '1') {
    const base=process.env.QWEN_TEST_URL||'http://127.0.0.1:8080';
    const response=await fetch(base+'/v1/models',{signal:AbortSignal.timeout(5000)});
    assert(response.ok);context.model=(await response.json()).data[0].id;
    context.base=base;context.fetch=fetch;
    run('QWEN_BASE_URL=base;state.qwenModelId=model');
    for (const prompt of [
      '이 카메라와 CNN으로 양품과 불량을 분류하는 웹앱을 만들어 주세요. 분류 결과만 화면에 보여 주세요.',
      '이 카메라 영상을 표시하는 웹앱을 만들어 주세요. CNN은 사용하지 마세요.',
      '이 카메라와 CNN으로 물체 있음, 물체 없음 두 클래스를 학습하는 웹앱을 만들어 주세요. 물체 있음이면 모터 전진 속도 35, 물체 없음이면 모터 정지 속도 0으로 제어하세요.'
    ]) {
      // Preview-only request must not accidentally ask for CNN via the negative phrase.
      const actualPrompt=prompt.replace(' CNN은 사용하지 마세요.','');
      const actual=await run('generateWithQwen('+JSON.stringify(actualPrompt)+')');
      assert(actual.widgets.some(w=>['classifier','camera_stream'].includes(w.type)));
      assert(actual.widgets.filter(w=>['classifier','camera_stream'].includes(w.type)).every(w=>w.action.source.url===source.url));
      if (actualPrompt.includes('속도 35')) assert(actual.widgets.some(w=>w.type==='classifier'&&w.action.rules.some(r=>r.text==='CMD:motor:forward:35')));
      console.log('PASS: real Qwen '+actualPrompt);
    }
  }
  console.log('PASS: source validation, webcam compatibility, preview/CNN distinction, URL preservation, mocked Qwen correction, invented IP rejection.');
})().catch(error => { console.error(error); process.exitCode = 1; });
