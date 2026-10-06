const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');

for (const root of ['microbit', 'physical/microbit']) {
  const files = ['tests/makecode-stubs.d.ts', `${root}/main.ts`, `${root}/examples/protocol-v1-demo.ts`, `${root}/examples/protocol-v1-servo.ts`, `${root}/examples/protocol-v1-servo-value.ts`, `${root}/examples/wifi-only-check.ts`];
  const program = ts.createProgram(files, { noEmit: true, target: ts.ScriptTarget.ES5, types: [] });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: f => f, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n',
  }));
  const writes = [], seen = [], moves = [], redirects = [];
  let receive, incoming = '', receiverRegistrations = 0;
  const startupChecks = [];
  const context = {
    SerialPin: { P14: 14, P15: 15 }, BaudRate: { BaudRate9600: 9600, BaudRate115200: 115200 },
    AnalogPin: { P0: 0, P1: 1, P2: 2, P14: 14, P15: 15 }, Delimiters: { NewLine: 0 },
    pins: { servoWritePin(pin, angle) { moves.push([pin, angle]); } },
    basic: { pause(ms) {
      if (ms === 500) startupChecks.push(context.esp32wifiuart.startupStateForTest());
    }, showString(text) { seen.push(['display', text]); } },
    serial: {
      redirect(tx, rx, baud) { redirects.push([tx, rx, baud]); }, setRxBufferSize() {},
      writeLine(text) { writes.push(text); }, delimiters: () => '\n',
      onDataReceived(_, handler) { receive = handler; ++receiverRegistrations; }, readUntil: () => incoming,
    },
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(fs.readFileSync(files[1], 'utf8').replace('    let started = false', '    export function startupStateForTest(): boolean { return started && initializingUART }\n    let started = false'), {
    compilerOptions: { target: ts.ScriptTarget.ES5, module: ts.ModuleKind.None },
  }).outputText, context);
  const api = context.esp32wifiuart;
  context.handler = () => seen.push([api.protocolCommandId(), api.protocolCommandText()]);
  vm.runInContext('esp32wifiuart.onServerMessage(handler)', context);
  assert.equal(redirects[0][2], root === 'microbit' ? 115200 : 9600);
  assert.deepEqual(startupChecks, [true]); // started/initializing guard set before first yielding pause.
  const initialStarts = writes.filter(text => text === 'MB_START').length;
  api.start(); api.start(); api.startWithBaudRate(redirects[0][2]);
  assert.equal(redirects.length, 1);
  assert.equal(writes.filter(text => text === 'MB_START').length, initialStarts);
  assert.equal(receiverRegistrations, 1);

  function inject(text) { incoming = text; receive(); }
  const beforeStatus = writes.length;
  inject('STATUS:WIFI_CONNECTED\r');
  assert.equal(api.esp32Status(), 'WIFI_CONNECTED');
  assert.equal(seen.length, 0); assert.equal(writes.length, beforeStatus);
  api.onServerMessage(context.handler);
  assert.equal(receiverRegistrations, 1);
  inject('V1:CMD:test-a: a :b \r');
  assert.deepEqual(seen.pop(), ['test-a', ' a :b ']);
  api.acknowledgeCommand('test-a'); assert.equal(writes.at(-1), 'V1:ACK:test-a:OK');
  inject('V1:CMD:test-a: a :b \r'); assert.equal(seen.length, 0);
  assert.equal(writes.at(-1), 'V1:ACK:test-a:OK');
  inject('V1:CMD:error:b'); api.rejectCommand('error', 'UNSUPPORTED_COMMAND');
  assert.equal(writes.at(-1), 'V1:ACK:error:ERR:UNSUPPORTED_COMMAND');
  api.rejectCommand('invalid', 'bad\ncode'); assert.equal(writes.at(-1), 'V1:ACK:invalid:ERR:DEVICE_ERROR');
  inject(' a \r'); assert.deepEqual(seen.pop(), ['', ' a ']);
  api.sendSensor('temperature', 25); assert.equal(writes.at(-1), 'DATA:temperature:25');

  // Reporter blocks parse the latest message without executing or acknowledging it.
  api.onServerMessage(() => {});
  const beforeReporters = writes.length;
  for (const [text, target, expected] of [
    ['CMD:servo:134', api.ServoTarget.Servo, 134],
    ['V1:CMD:value-134:CMD:servo:134', api.ServoTarget.Servo, 134],
    ['CMD:servo:0', api.ServoTarget.Servo, 0],
    ['CMD:servo:180', api.ServoTarget.Servo, 180],
    ['CMD:valve:45', api.ServoTarget.Valve, 45],
    ['V1:CMD:value-mouth:CMD:mouth:90', api.ServoTarget.Mouth, 90],
    ['CMD:valve:45', api.ServoTarget.Servo, -1],
    ['CMD:servo:181', api.ServoTarget.Servo, -1],
    ['CMD:servo:-1', api.ServoTarget.Servo, -1],
    ['CMD:servo:90.5', api.ServoTarget.Servo, -1],
    ['CMD:servo:134junk', api.ServoTarget.Servo, -1],
    ['CMD:servo:', api.ServoTarget.Servo, -1],
    ['CMD:servo:90:extra', api.ServoTarget.Servo, -1],
    ['a', api.ServoTarget.Servo, -1],
  ]) {
    inject(text);
    assert.equal(api.receivedServoAngle(target), expected, text);
    assert.equal(api.isServoCommand(target), expected >= 0, text);
  }
  inject('CMD:servo:134');
  assert.equal(api.receivedServoAngle(), 134); // Default dropdown target is servo.
  assert.equal(api.isServoCommand(), true);
  assert.equal(moves.length, 0);
  assert.equal(writes.length, beforeReporters);

  api.startWithBaudRate(context.BaudRate.BaudRate115200);
  assert.deepEqual(redirects.at(-1), [14, 15, 115200]);
  api.onServerMessage(() => api.executeServerCommand());
  inject('V1:CMD:unconfigured:CMD:servo:134');
  assert.equal(writes.at(-1), 'V1:ACK:unconfigured:ERR:SERVO_NOT_CONFIGURED');
  assert.equal(moves.length, 0);
  api.configureServo(api.ServoTarget.Servo, context.AnalogPin.P0);
  inject('V1:CMD:servo-134:CMD:servo:134\r');
  assert.deepEqual(moves.at(-1), [0, 134]);
  assert.equal(writes.at(-1), 'V1:ACK:servo-134:OK');
  inject('V1:CMD:servo-134:CMD:servo:134');
  assert.equal(moves.length, 1); // Completed duplicate never moves again.
  const beforeLegacy = writes.length;
  inject('CMD:servo:90');
  assert.deepEqual(moves.at(-1), [0, 90]); assert.equal(writes.length, beforeLegacy);
  for (const angle of ['0', '180']) {
    inject(`V1:CMD:angle-${angle}:CMD:servo:${angle}`);
    assert.deepEqual(moves.at(-1), [0, Number(angle)]);
  }
  const beforeInvalid = moves.length;
  for (const [i, angle] of ['-1', '181', 'NaN', '90junk', '90.5', ' 90', ''].entries()) {
    inject(`V1:CMD:bad-${i}:CMD:servo:${angle}`);
    assert.equal(writes.at(-1), `V1:ACK:bad-${i}:ERR:INVALID_ANGLE`);
    assert.equal(moves.length, beforeInvalid);
  }
  for (const [i, text] of ['CMD:motor:50', 'CMD:unknown:90', 'CMD:servo:90:extra'].entries()) {
    inject(`V1:CMD:unsupported-${i}:${text}`);
    assert.equal(writes.at(-1), `V1:ACK:unsupported-${i}:ERR:UNSUPPORTED_COMMAND`);
  }
  api.configureServo(api.ServoTarget.Valve, context.AnalogPin.P14);
  inject('V1:CMD:uart:CMD:valve:90');
  assert.equal(writes.at(-1), 'V1:ACK:uart:ERR:SERVO_NOT_CONFIGURED');
  api.configureServo(api.ServoTarget.Valve, context.AnalogPin.P1);
  inject('V1:CMD:valve:CMD:valve:45'); assert.deepEqual(moves.at(-1), [1, 45]);
  api.configureServo(api.ServoTarget.Mouth, context.AnalogPin.P2);
  inject('V1:CMD:mouth:CMD:mouth:100'); assert.deepEqual(moves.at(-1), [2, 100]);
  inject('V1:CMD:display:a');
  assert.deepEqual(seen.at(-1), ['display', 'a']); assert.equal(writes.at(-1), 'V1:ACK:display:OK');
  // A Wi-Fi-only project still drains STATUS without installing a user message handler.
  const wifiWrites = [];
  let wifiReceive, wifiIncoming = '', wifiRedirects = 0, wifiReceivers = 0;
  const wifiContext = {
    ...context, basic: { pause() {} },
    serial: {
      redirect() { ++wifiRedirects; }, setRxBufferSize() {},
      writeLine(text) { wifiWrites.push(text); }, delimiters: () => '\n',
      onDataReceived(_, callback) { wifiReceive = callback; ++wifiReceivers; },
      readUntil() { return wifiIncoming; },
    },
  };
  delete wifiContext.esp32wifiuart;
  vm.createContext(wifiContext);
  vm.runInContext(ts.transpileModule(fs.readFileSync(files[1], 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES5, module: ts.ModuleKind.None },
  }).outputText, wifiContext);
  vm.runInContext(fs.readFileSync(`${root}/examples/wifi-only-check.ts`, 'utf8'), wifiContext);
  assert.equal(wifiRedirects, 1); assert.equal(wifiReceivers, 1);
  assert.equal(wifiWrites.filter(text => text === 'CONNECT').length, 1);
  wifiIncoming = 'STATUS:WIFI_CONNECTED\r'; wifiReceive();
  assert.equal(wifiContext.esp32wifiuart.esp32Status(), 'WIFI_CONNECTED');
  assert.equal(wifiWrites.filter(text => text === 'CONNECT').length, 1);
  console.log(`${root}: type checks, idempotent UART startup, single receiver/status handling, UART settings, literal parsing, received-angle/condition blocks, servo routing/ranges, ACKs, duplicate suppression and legacy commands passed.`);
}
