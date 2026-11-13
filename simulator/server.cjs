const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const host = process.env.PHYVIBE_SIM_HOST || '127.0.0.1';
const port = Number(process.env.PHYVIBE_SIM_PORT || 5002);
const state = { x: 0, y: 0, heading: 0, direction: 'stop', speed: 0,
  servo: 90, valve: 0, mouth: 0, sequence: 0, history: [], lastTick: Date.now(),
  latestCommand: '', latestCommandTime: '', latestMessage: '', latestTime: '' };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const stamp = () => new Date().toISOString();

function record(message) {
  state.sequence++;
  state.latestMessage = message;
  state.latestTime = stamp();
  state.history.push({ id: state.sequence, message, time: state.latestTime });
  state.history = state.history.slice(-20);
}
function tick() {
  const now = Date.now();
  const dt = clamp((now - state.lastTick) / 1000, 0, 2);
  state.lastTick = now;
  const rate = state.speed / 80;
  if (state.direction === 'left' || state.direction === 'right') {
    state.heading += (state.direction === 'left' ? -1 : 1) * rate * 2.2 * dt;
  } else if (state.direction === 'forward' || state.direction === 'backward') {
    const sign = state.direction === 'forward' ? 1 : -1;
    state.x = clamp(state.x + Math.sin(state.heading) * sign * rate * 0.7 * dt, -0.92, 0.92);
    state.y = clamp(state.y - Math.cos(state.heading) * sign * rate * 0.7 * dt, -0.92, 0.92);
  }
}
function command(value) {
  if (typeof value !== 'string' || !value.trim() || [...value].length > 256 || /[\r\n]/.test(value) || value.startsWith('PHYVIBE_LINK_'))
    return { code: 400, body: { error: 'A single command line of 1-256 characters is required' } };
  tick();
  const motor = /^CMD:motor:(forward|backward|left|right|stop):(\d+)$/i.exec(value);
  const speed = /^CMD:motor:(\d+)$/i.exec(value);
  const servo = /^CMD:(servo|valve|mouth):(\d+)$/i.exec(value);
  const pwm = /^MOT:(-?\d+):(-?\d+)$/i.exec(value);
  if (motor && Number(motor[2]) <= 80) {
    state.speed = motor[1].toLowerCase() === 'stop' ? 0 : Number(motor[2]);
    state.direction = state.speed ? motor[1].toLowerCase() : 'stop';
  } else if (speed && Number(speed[1]) <= 80) {
    state.speed = Number(speed[1]);
    state.direction = state.speed ? 'forward' : 'stop';
  } else if (servo && Number(servo[2]) <= 180) {
    state[servo[1].toLowerCase()] = Number(servo[2]);
  } else if (pwm && Math.abs(Number(pwm[1])) <= 255 && Math.abs(Number(pwm[2])) <= 255) {
    const left = Number(pwm[1]), right = Number(pwm[2]);
    state.speed = Math.round(Math.max(Math.abs(left), Math.abs(right)) / 255 * 80);
    state.direction = !state.speed ? 'stop' : Math.abs(left - right) > 30 ? (left > right ? 'right' : 'left') : left < 0 ? 'backward' : 'forward';
  } else if (/^(CMD:|MOT:)/i.test(value)) {
    return { code: 400, body: { error: 'Unsupported simulator command' } };
  }
  state.latestCommand = value;
  state.latestCommandTime = stamp();
  return { code: 200, body: { command: value, sent_count: 1 } };
}
function snapshot() {
  tick();
  return { x: state.x, y: state.y, heading: state.heading, direction: state.direction,
    speed: state.speed, servo: state.servo, valve: state.valve, mouth: state.mouth };
}
const telemetry = setInterval(() => {
  const sim = snapshot();
  for (const [key, value] of Object.entries({ x: Math.round(sim.x * 100), y: Math.round(sim.y * 100),
    heading: Math.round(sim.heading * 180 / Math.PI), speed: sim.speed, servo: sim.servo }))
    record(`DATA:${key}:${value}`);
}, 1000);
telemetry.unref();
function status() {
  return { server: 'phyvibe-2d-simulator', running: true, connected_clients: 1,
    healthy_clients: 1, message_sequence: state.sequence, message_history: state.history,
    latest_message: state.latestMessage, latest_time: state.latestTime,
    latest_command: state.latestCommand, latest_command_time: state.latestCommandTime,
    simulator: snapshot() };
}
function reply(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  if (req.method === 'GET' && (req.url === '/api/status' || req.url === '/api/health')) return reply(res, 200, status());
  if (req.method === 'GET' && req.url === '/api/sim/state') return reply(res, 200, snapshot());
  if (req.method === 'GET' && req.url === '/scene') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return fs.createReadStream(path.join(__dirname, 'scene.html')).pipe(res);
  }
  if (req.method === 'POST' && req.url === '/api/command') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 16384) req.destroy(); });
    return req.on('end', () => {
      try { const result = command(JSON.parse(body).command); reply(res, result.code, result.body); }
      catch { reply(res, 400, { error: 'JSON object with string command required' }); }
    });
  }
  reply(res, 404, { error: 'Unknown endpoint or method' });
});
if (require.main === module) server.listen(port, host, () => console.log(`PHYVIBE 2D simulator: http://${host}:${port}/scene`));
module.exports = { server, command, snapshot, status, state };
