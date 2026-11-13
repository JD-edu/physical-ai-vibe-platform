const assert = require('node:assert/strict');
const { server } = require('./server.cjs');

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = async command => {
    const response = await fetch(`${base}/api/command`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command }) });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await fetch(`${base}/scene`)).status, 200);
    assert.equal((await send('CMD:motor:forward:80')).body.sent_count, 1);
    await new Promise(resolve => setTimeout(resolve, 250));
    const moved = (await (await fetch(`${base}/api/sim/state`)).json()).y;
    assert(moved < -0.05, `Robot did not move forward: ${moved}`);
    assert.equal((await send('CMD:motor:left:80')).status, 200);
    await new Promise(resolve => setTimeout(resolve, 250));
    const turned = (await (await fetch(`${base}/api/sim/state`)).json()).heading;
    assert(turned < -0.2, `Robot did not turn left: ${turned}`);
    assert.equal((await send('CMD:motor:stop:0')).status, 200);
    assert.equal((await send('CMD:servo:135')).status, 200);
    const stopped = (await (await fetch(`${base}/api/status`)).json());
    assert.equal(stopped.simulator.direction, 'stop');
    assert.equal(stopped.simulator.servo, 135);
    assert.equal(stopped.connected_clients, 1);
    assert.equal((await send('CMD:motor:forward:99')).status, 400);
    await new Promise(resolve => setTimeout(resolve, 1100));
    const telemetry = (await (await fetch(`${base}/api/status`)).json()).message_history;
    assert(telemetry.some(item => item.message.startsWith('DATA:y:')));
    console.log('PASS: simulator HTTP bridge, 2D movement, turning, stop, servo, invalid command');
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
