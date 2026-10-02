const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const defaultWidgets = [
  { id: "temperature", type: "metric", title: "현재 온도", icon: "🌡", value: 24.6, unit: "°C", min: 0, max: 40, trend: "+0.4°C", pin: "P0" },
  { id: "humidity", type: "gauge", title: "상대 습도", icon: "◌", value: 58, unit: "%", min: 0, max: 100, pin: "P1" },
  { id: "chart", type: "chart", title: "온도 변화", icon: "⌁", value: 24.6, unit: "°C", wide: true, points: [21, 24, 22, 28, 26, 31, 29, 35, 33, 39] },
  { id: "distance", type: "alert", title: "접근 감지", icon: "◉", value: 34, unit: "cm", threshold: 10, pin: "P2" },
  { id: "servo", type: "control", title: "서보 모터", icon: "↻", value: 90, unit: "°", min: 0, max: 180, pin: "P0" }
];

const state = {
  widgets: structuredClone(defaultWidgets),
  target: "widget",
  bridge: null,
  serialPort: null,
  reader: null,
  writer: null,
  logs: [],
  generating: false,
  provider: localStorage.getItem("phyvibe.provider") || "demo",
  model: "qwen3-8b",
  qwenModelId: null,
  apiKey: localStorage.getItem("phyvibe.apiKey") || ""
};

const modelOptions = {
  demo: [{ value: "rule-engine", label: "내장 데모 엔진 (API 키 불필요)" }],
  qwen: [{ value: "qwen3-8b", label: "Qwen3 8B (llama.cpp)" }],
  openai: [{ value: "gpt-4o-mini", label: "GPT-4o mini" }, { value: "gpt-4o", label: "GPT-4o" }],
  gemini: [{ value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" }, { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" }]
};

const QWEN_BASE_URL = "http://localhost:8081";
let qwenRetryTimer = null;
let qwenConnecting = false;

async function checkQwenConnection() {
  if (qwenConnecting) return false;
  qwenConnecting = true;
  const status = $("#qwenStatusText");
  const dot = $("#qwenStatusDot");
  status.textContent = "Qwen3 8B 연결 확인 중";
  dot.className = "";
  try {
    const response = await fetch(`${QWEN_BASE_URL}/v1/models`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`llama.cpp HTTP ${response.status}`);
    const data = await response.json();
    const models = Array.isArray(data.data) ? data.data : [];
    const loaded = models.find(item => /qwen/i.test(item.id || "")) || models[0];
    if (!loaded?.id) throw new Error("llama.cpp에 로드된 모델이 없습니다.");
    state.qwenModelId = loaded.id;
    status.textContent = "Qwen3 8B 연결 완료";
    dot.className = "online";
    $("#qwenStartupMessage").textContent = `${state.qwenModelId} 모델이 준비되었습니다. 스튜디오를 시작합니다.`;
    clearTimeout(qwenRetryTimer);
    setTimeout(() => $("#qwenStartupDialog").open && $("#qwenStartupDialog").close(), 450);
    return true;
  } catch (error) {
    status.textContent = "연결되지 않음";
    dot.className = "error";
    $("#qwenStartupMessage").textContent = error.message.includes("모델") ? error.message : "llama-server 또는 Qwen3 8B가 아직 실행되지 않았습니다. LLM을 가동하면 자동으로 다시 연결합니다.";
    clearTimeout(qwenRetryTimer);
    qwenRetryTimer = setTimeout(checkQwenConnection, 3000);
    return false;
  } finally {
    qwenConnecting = false;
  }
}

function startQwenGate() {
  if (state.provider !== "qwen") return;
  const dialog = $("#qwenStartupDialog");
  if (!dialog.open) dialog.showModal();
  checkQwenConnection();
}

function extractJson(text) {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Qwen 응답에서 JSON을 찾지 못했습니다.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function normalizeWidgets(items) {
  const allowedTypes = new Set(["metric", "gauge", "chart", "alert", "control"]);
  return items.slice(0, 8).map((item, index) => {
    const type = allowedTypes.has(item.type) ? item.type : "metric";
    const min = Number.isFinite(Number(item.min)) ? Number(item.min) : 0;
    let max = Number.isFinite(Number(item.max)) ? Number(item.max) : 100;
    if (/servo/i.test(item.id || item.title || "")) max = Math.min(max, 180);
    if (/motor|모터/i.test(item.id || item.title || "")) max = Math.min(max, 80);
    return { id: String(item.id || `widget-${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, "-"), type, title: String(item.title || "센서 데이터"), icon: String(item.icon || "◇"), value: Number(item.value) || 0, unit: String(item.unit || ""), min, max, threshold: Number(item.threshold) || 10, pin: String(item.pin || "P0"), wide: Boolean(item.wide), points: Array.isArray(item.points) ? item.points.map(Number).filter(Number.isFinite).slice(0, 20) : undefined };
  });
}

async function generateWithQwen(prompt) {
  if (!state.qwenModelId && !(await checkQwenConnection())) throw new Error("Qwen3 8B에 연결할 수 없습니다.");
  const system = `You are PHYVIBE, a physical AI dashboard architect. Return JSON only, without markdown or explanation. Schema: {"title":"Korean dashboard title","widgets":[{"id":"english-id","type":"metric|gauge|chart|alert|control","title":"Korean label","icon":"one emoji","value":number,"unit":"string","min":number,"max":number,"threshold":number,"pin":"P0","wide":boolean,"points":[numbers]}]}. Create at most 8 widgets. Servo range must be 0..180. DC motor maximum must be 80. Prefer simple MakeCode-compatible sensor keys.`;
  const response = await fetch(`${QWEN_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: state.qwenModelId, stream: false, messages: [{ role: "system", content: system }, { role: "user", content: prompt }], temperature: 0.2 }),
    signal: AbortSignal.timeout(120000)
  });
  if (!response.ok) throw new Error(`Qwen 요청 실패 (HTTP ${response.status})`);
  const data = await response.json();
  const result = extractJson(data.choices?.[0]?.message?.content || "");
  if (!Array.isArray(result.widgets) || !result.widgets.length) throw new Error("Qwen이 위젯을 생성하지 못했습니다.");
  return { title: String(result.title || "피지컬 AI 대시보드"), widgets: normalizeWidgets(result.widgets) };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}

function renderWidget(widget) {
  const wide = widget.wide ? " wide" : "";
  const warning = widget.type === "alert" && Number(widget.value) <= Number(widget.threshold) ? " warning" : "";
  const head = `<div class="widget-head"><span>${escapeHtml(widget.title)}</span><span class="widget-icon">${escapeHtml(widget.icon || "◇")}</span></div>`;
  if (widget.type === "chart") {
    const pts = widget.points || [20, 25, 23, 32, 28, 35];
    const max = Math.max(...pts), min = Math.min(...pts);
    const points = pts.map((v, i) => `${(i / (pts.length - 1)) * 100},${55 - ((v - min) / Math.max(1, max - min)) * 45}`).join(" ");
    return `<article class="widget${wide}" data-widget="${widget.id}">${head}<div class="chart"><svg viewBox="0 0 100 60" preserveAspectRatio="none"><defs><linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#3988e8"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><path class="chart-grid" d="M0 15H100M0 30H100M0 45H100"/><polygon class="chart-fill" points="0,60 ${points} 100,60"/><polyline class="chart-line" points="${points}"/></svg></div><div class="widget-main"><span class="widget-value">${widget.value}</span><span class="widget-unit">${widget.unit}</span><span class="trend">실시간</span></div></article>`;
  }
  if (widget.type === "gauge") {
    const ratio = Math.min(100, Math.max(0, ((Number(widget.value) - Number(widget.min || 0)) / Math.max(1, Number(widget.max || 100) - Number(widget.min || 0))) * 100));
    const status = Number(widget.value) < Number(widget.threshold || -Infinity) ? "주의" : "정상";
    return `<article class="widget${wide}${status === "주의" ? " warning" : ""}" data-widget="${widget.id}">${head}<div class="gauge" style="--gauge-value:${ratio}%"></div><div class="widget-main"><span class="widget-value">${widget.value}</span><span class="widget-unit">${widget.unit}</span><span class="trend">${status}</span></div></article>`;
  }
  if (widget.type === "control") {
    const command = widget.command === "MOT" ? `MOT:${widget.value}:${widget.value}` : `${widget.command || `CMD:${widget.id}`}:${widget.value}`;
    const stop = widget.command === "MOT" ? "MOT:0:0" : `${widget.command || `CMD:${widget.id}`}:0`;
    return `<article class="widget${wide}" data-widget="${widget.id}">${head}<div class="widget-main"><span class="widget-value" data-control-value>${widget.value}</span><span class="widget-unit">${widget.unit}</span></div><div class="slider-row"><span>${widget.min}</span><input type="range" min="${widget.min}" max="${widget.max}" value="${widget.value}" data-control="${widget.id}"><span>${widget.max}</span></div><div class="action-row"><button class="widget-action" data-command="${stop}">정지</button><button class="widget-action primary" data-command="${command}">적용</button></div></article>`;
  }
  return `<article class="widget${wide}${warning}" data-widget="${widget.id}">${head}<div class="widget-main"><span class="widget-value">${widget.value}</span><span class="widget-unit">${widget.unit}</span>${widget.trend ? `<span class="trend">${escapeHtml(widget.trend)}</span>` : ""}</div><div class="meter"><i style="width:${Math.min(100, Math.max(3, (widget.value - (widget.min || 0)) / ((widget.max || 100) - (widget.min || 0)) * 100))}%"></i></div>${widget.type === "alert" ? `<div class="action-row"><button class="widget-action primary" data-command="CMD:alarm:test">경보 테스트</button><span class="widget-action">기준 ${widget.threshold}${widget.unit}</span></div>` : ""}</article>`;
}

function renderWidgets() {
  $("#widgetGrid").innerHTML = state.widgets.map(renderWidget).join("");
  $("#schemaContent").textContent = JSON.stringify({ version: 1, title: $("#dashboardTitle").textContent, widgets: state.widgets }, null, 2);
  $("#codeContent").textContent = `// PHYVIBE Dynamic Widget Schema\nconst dashboard = ${$("#schemaContent").textContent};\n\n// UART / WebSocket sensor packet\nfunction onPacket({ type, k, val }) {\n  if (type !== "sensor") return;\n  const widget = dashboard.widgets.find(item => item.id === k);\n  if (widget) widget.value = val;\n}\n`;
}

function addLog(direction, message, level = "") {
  const time = new Date().toLocaleTimeString("ko-KR", { hour12: false });
  state.logs.push({ time, direction, message, level });
  state.logs = state.logs.slice(-80);
  $("#terminal").innerHTML = state.logs.map(log => `<div class="log-row"><span class="time">${log.time}</span><span class="${log.level || log.direction.toLowerCase()}">${log.direction}</span><span>${escapeHtml(log.message)}</span></div>`).join("");
  $("#terminal").scrollTop = $("#terminal").scrollHeight;
}

function toast(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 2200);
}

function appendMessage(role, text, typing = false) {
  const article = document.createElement("article");
  article.className = `message ${role === "user" ? "user-message" : "ai-message build-message"}`;
  article.innerHTML = role === "user" ? `<div><p>${escapeHtml(text)}</p></div>` : `<div class="bot-icon">✦</div><div class="${typing ? "typing" : ""}"><strong>PHYVIBE AI</strong><p>${escapeHtml(text)}</p></div>`;
  $("#conversation").append(article); $("#conversation").scrollTop = $("#conversation").scrollHeight;
  return article;
}

function widgetsFromPrompt(prompt) {
  const p = prompt.toLowerCase();
  const widgets = [];
  if (/화분|토양|soil|급수/.test(p)) {
    widgets.push({ id: "soil", type: "gauge", title: "토양 수분", icon: "🌱", value: 24, unit: "%", min: 0, max: 100, threshold: 30, pin: "P1" });
    widgets.push({ id: "valve", type: "control", title: "급수 밸브", icon: "💧", value: 0, unit: "°", min: 0, max: 180, pin: "P0", command: "CMD:valve" });
  }
  if (/터틀|자율주행|좌우 모터/.test(p)) {
    widgets.push({ id: "sonar", type: "alert", title: "전방 거리", icon: "◉", value: 42, unit: "cm", threshold: 15, min: 0, max: 100, pin: "P2" });
    widgets.push({ id: "motor", type: "control", title: "주행 속도", icon: "🐢", value: 120, unit: "PWM", min: -255, max: 255, pin: "TB6612", command: "MOT" });
  }
  if (/온도|온습도|temperature/.test(p)) widgets.push({ id: "temperature", type: "metric", title: "실내 온도", icon: "🌡", value: 24.6, unit: "°C", min: 0, max: 40, trend: "+0.4°C", pin: "P0" });
  if (/습도|온습도|humidity/.test(p)) widgets.push({ id: "humidity", type: "gauge", title: "상대 습도", icon: "◌", value: 58, unit: "%", min: 0, max: 100, pin: "P1" });
  if (/거리|초음파|접근/.test(p)) widgets.push({ id: "distance", type: "alert", title: "접근 감지", icon: "◉", value: 34, unit: "cm", threshold: 10, min: 0, max: 100, pin: "P2" });
  if (/모터|팬|motor/.test(p)) widgets.push({ id: "motor", type: "control", title: "DC 모터 속도", icon: "⚙", value: 50, unit: "%", min: 0, max: 80, pin: "ESP32" });
  if (/서보|servo/.test(p)) widgets.push({ id: "servo", type: "control", title: "서보 각도", icon: "↻", value: 90, unit: "°", min: 0, max: 180, pin: "P0" });
  if (/조도|빛|light/.test(p)) widgets.push({ id: "light", type: "metric", title: "주변 조도", icon: "☀", value: 72, unit: "%", min: 0, max: 100, pin: "P1" });
  if (/차트|그래프|변화|모니터/.test(p)) widgets.push({ id: "chart", type: "chart", title: "센서 변화", icon: "⌁", value: 24.6, unit: "", wide: true, points: [20, 24, 22, 29, 26, 33, 31, 38] });
  return widgets.length ? widgets : [{ id: "sensor", type: "metric", title: "센서 데이터", icon: "◇", value: 42, unit: "", min: 0, max: 100, pin: "P0" }];
}

async function generate() {
  const input = $("#promptInput"); const prompt = input.value.trim();
  if (!prompt || state.generating) return;
  state.generating = true; $("#generateBtn").disabled = true; appendMessage("user", prompt); input.value = "";
  const typing = appendMessage("ai", "요청을 분석하고 하드웨어 안전 규칙을 적용하는 중…", true);
  await new Promise(resolve => setTimeout(resolve, 700));
  if (state.target === "widget") {
    try {
      const generated = state.provider === "qwen"
        ? await generateWithQwen(prompt)
        : { title: /화분|토양/.test(prompt) ? "잔소리 식물 화분" : /터틀|자율주행/.test(prompt) ? "자율주행 터틀 컨트롤" : (prompt.length > 20 ? "새 피지컬 AI 대시보드" : prompt.replace(/만들어줘|보여줘|해줘/g, "").trim()), widgets: widgetsFromPrompt(prompt) };
      state.widgets = generated.widgets;
      $("#dashboardTitle").textContent = generated.title;
      renderWidgets();
      typing.querySelector("div:last-child").classList.remove("typing");
      typing.querySelector("p").textContent = `${state.provider === "qwen" ? "Qwen3 8B가 " : ""}${state.widgets.length}개의 위젯을 생성했어요. 핀맵과 안전 범위를 적용했습니다.`;
    } catch (error) {
      typing.querySelector("div:last-child").classList.remove("typing");
      typing.querySelector("p").textContent = `생성 실패: ${error.message}`;
      state.generating = false;
      $("#generateBtn").disabled = false;
      if (state.provider === "qwen") startQwenGate();
      return;
    }
  } else if (state.target === "makecode") {
    $("#codeContent").textContent = `esp32wifiuart.start()\n\ninput.onButtonPressed(Button.A, function () {\n    esp32wifiuart.sendLine("CMD:action")\n})\n\nesp32wifiuart.onServerMessage(function () {\n    basic.showString(esp32wifiuart.serverMessage())\n})`;
    switchView("code"); typing.querySelector("div:last-child").classList.remove("typing"); typing.querySelector("p").textContent = "MakeCode 통신 코드를 생성했어요. 코드 탭에서 확인하세요.";
  } else {
    typing.querySelector("div:last-child").classList.remove("typing"); typing.querySelector("p").textContent = "친절한 피지컬 컴퓨팅 코치 페르소나를 적용했어요. 위험한 동작은 실행 전에 확인합니다.";
  }
  state.generating = false; $("#generateBtn").disabled = false; $("#savedState").textContent = "저장됨"; toast("안전 규칙을 적용해 생성했습니다");
}

function switchView(view) {
  $$("#viewTabs button").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  $("#previewFrame").classList.toggle("hidden", view !== "preview");
  $("#codeView").classList.toggle("hidden", view !== "code");
  $("#schemaView").classList.toggle("hidden", view !== "schema");
}

function setConnection(mode, label, sub) {
  const icon = $("#connectionIcon"); icon.className = `connection-icon ${mode}`; icon.textContent = mode === "online" ? "●" : mode === "error" ? "!" : "⌁";
  $("#connectionLabel").textContent = label; $("#connectionSub").textContent = sub;
}

function handlePacket(raw) {
  addLog("RX", raw);
  const line = raw.trim();
  const dataMatch = line.match(/^DATA:([^:]+):(.+)$/i);
  if (dataMatch) {
    const [, key, rawValue] = dataMatch;
    const numeric = Number(rawValue);
    const value = Number.isFinite(numeric) ? numeric : rawValue;
    const widget = state.widgets.find(w => w.id.toLowerCase() === key.toLowerCase());
    if (widget) { widget.value = value; if (widget.points) widget.points = [...widget.points.slice(-11), Number(value) || 0]; renderWidgets(); }
    $("#lastUpdated").textContent = "방금 전";
    return;
  }
  try {
    const packet = JSON.parse(raw);
    if (packet.type === "sensor") {
      const widget = state.widgets.find(w => w.id === packet.k); if (widget) { widget.value = packet.val; renderWidgets(); }
      $("#lastUpdated").textContent = "방금 전";
    }
  } catch { /* raw UART data is still useful in the console */ }
}

function toggleBridge(enabled) {
  if (!enabled) { if (state.bridge) state.bridge.close(); state.bridge = null; setConnection("", "기기 대기 중", "브릿지가 중지되었습니다"); return; }
  setConnection("", "브릿지 연결 중", "ws://localhost:8080"); addLog("SYS", "Bridge connection requested");
  try {
    const ws = new WebSocket("ws://localhost:8080"); state.bridge = ws; const started = performance.now();
    ws.onopen = () => { setConnection("online", "연결 완료", "WebSocket · Port 8080"); $("#gatewayValue").textContent = "127.0.0.1"; $("#rssiValue").textContent = "-52 dBm"; $("#rttValue").textContent = `${Math.round(performance.now() - started)} ms`; addLog("SYS", "Bridge connected on port 8080"); };
    ws.onmessage = event => handlePacket(String(event.data));
    ws.onerror = () => { setConnection("error", "브릿지 미응답", "로컬 서버를 확인하세요"); addLog("ERR", "WebSocket connection failed", "err"); };
    ws.onclose = () => { if ($("#bridgeToggle").checked) setConnection("error", "연결 끊김", "재연결하려면 토글하세요"); };
  } catch (error) { setConnection("error", "연결 실패", error.message); }
}

async function connectSerial() {
  if (!("serial" in navigator)) { toast("Chrome 또는 Edge에서 Web Serial을 사용해 주세요"); return; }
  try {
    state.serialPort = await navigator.serial.requestPort(); await state.serialPort.open({ baudRate: 9600 });
    state.writer = state.serialPort.writable.getWriter(); setConnection("online", "USB 연결 완료", "ESP32 · 9600 baud"); $("#serialBtn").textContent = "✓ USB 장치 연결됨"; addLog("SYS", "Serial port opened at 9600 baud"); readSerial();
  } catch (error) { if (error.name !== "NotFoundError") addLog("ERR", error.message, "err"); }
}

async function readSerial() {
  const decoder = new TextDecoder(); let buffer = "";
  while (state.serialPort?.readable) {
    state.reader = state.serialPort.readable.getReader();
    try { while (true) { const { value, done } = await state.reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const lines = buffer.split(/\r?\n/); buffer = lines.pop(); lines.filter(Boolean).forEach(handlePacket); } }
    catch (error) { addLog("ERR", error.message, "err"); }
    finally { state.reader.releaseLock(); }
  }
}

async function sendSerial(text) {
  let value = text.trim(); if (!value) return;
  const servo = value.match(/^CMD:(servo|valve|mouth):(-?\d+(?:\.\d+)?)$/i);
  if (servo) {
    const safeAngle = Math.min(180, Math.max(0, Number(servo[2])));
    if (safeAngle !== Number(servo[2])) addLog("SAFE", `서보 각도 ${servo[2]}° → ${safeAngle}° 클램핑`);
    value = `CMD:${servo[1]}:${safeAngle}`;
  }
  const motor = value.match(/^MOT:(-?\d+):(-?\d+)$/i);
  if (motor) {
    const left = Math.min(255, Math.max(-255, Number(motor[1]))), right = Math.min(255, Math.max(-255, Number(motor[2])));
    value = `MOT:${left}:${right}`;
    if (left !== Number(motor[1]) || right !== Number(motor[2])) addLog("SAFE", `모터 PWM을 -255~255로 제한: ${value}`);
  }
  addLog("TX", value);
  if (state.writer) await state.writer.write(new TextEncoder().encode(`${value}\n`));
  else if (state.bridge?.readyState === WebSocket.OPEN) state.bridge.send(value);
  else toast("데모 전송 완료 · 장치 연결 시 실제 패킷이 전달됩니다");
}

function downloadProject() {
  const project = { name: $("#projectName").value, exportedAt: new Date().toISOString(), protocol: "phyvibe-json-v1", safety: { servo: [0, 180], motorMax: 80 }, widgets: state.widgets };
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "phyvibe-project.json"; a.click(); URL.revokeObjectURL(a.href); toast("프로젝트 JSON을 내보냈습니다");
}

function updateModelOptions() {
  const provider = $("#providerSelect").value; $("#modelSelect").innerHTML = modelOptions[provider].map(m => `<option value="${m.value}">${m.label}</option>`).join("");
  if (modelOptions[provider].some(m => m.value === state.model)) $("#modelSelect").value = state.model;
}

async function testApi() {
  const provider = $("#providerSelect").value, key = $("#apiKeyInput").value.trim(), result = $("#testResult");
  if (provider === "qwen") {
    result.className = "test-result"; result.textContent = "연결 확인 중…";
    const connected = await checkQwenConnection();
    result.className = connected ? "test-result ok" : "test-result error";
    result.textContent = connected ? "연결 성공 · 로컬 Qwen3 8B가 정상 응답했습니다." : "연결 실패 · Qwen3 8B를 실행해 주세요.";
    return;
  }
  if (!key) { result.className = "test-result error"; result.textContent = "API 키를 입력해 주세요."; return; }
  result.className = "test-result"; result.textContent = "연결 확인 중…";
  try {
    const url = provider === "openai" ? "https://api.openai.com/v1/models" : `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
    const options = provider === "openai" ? { headers: { Authorization: `Bearer ${key}` } } : {};
    const response = await fetch(url, options); if (!response.ok) throw new Error(`HTTP ${response.status}`);
    result.className = "test-result ok"; result.textContent = "연결 성공 · API가 정상 응답했습니다.";
  } catch (error) { result.className = "test-result error"; result.textContent = `연결 실패 · ${error.message}`; }
}

function bindEvents() {
  $("#generateBtn").addEventListener("click", generate); $("#promptInput").addEventListener("keydown", e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") generate(); });
  $$("[data-prompt]").forEach(button => button.addEventListener("click", () => { $("#promptInput").value = button.dataset.prompt; generate(); }));
  $$("#targetSegment button").forEach(button => button.addEventListener("click", () => { state.target = button.dataset.target; $$("#targetSegment button").forEach(b => b.classList.toggle("active", b === button)); }));
  $$("#viewTabs button").forEach(button => button.addEventListener("click", () => switchView(button.dataset.view)));
  $$("[data-width]").forEach(button => button.addEventListener("click", () => { $$("[data-width]").forEach(b => b.classList.toggle("active", b === button)); $("#previewFrame").classList.remove("desktop", "tablet", "mobile"); $("#previewFrame").classList.add(button.dataset.width); }));
  $$(".mobile-tabs button").forEach(button => button.addEventListener("click", () => { $$(".mobile-tabs button").forEach(b => b.classList.toggle("active", b === button)); $$(".studio-grid > .panel").forEach(p => p.classList.toggle("mobile-active", p.id === button.dataset.panel)); }));
  $("#widgetGrid").addEventListener("input", e => { if (!e.target.matches("[data-control]")) return; const widget = state.widgets.find(w => w.id === e.target.dataset.control); widget.value = Math.min(Number(widget.max), Math.max(Number(widget.min), Number(e.target.value))); e.target.closest(".widget").querySelector("[data-control-value]").textContent = widget.value; });
  $("#widgetGrid").addEventListener("click", e => {
    const command = e.target.dataset.command; if (!command) return;
    const current = e.target.closest(".widget")?.querySelector("[data-control-value]")?.textContent;
    if (!current || /:0(?::0)?$/.test(command)) return sendSerial(command);
    sendSerial(command.startsWith("MOT:") ? `MOT:${current}:${current}` : command.replace(/:-?\d+(?:\.\d+)?$/, `:${current}`));
  });
  $("#bridgeToggle").addEventListener("change", e => toggleBridge(e.target.checked)); $("#serialBtn").addEventListener("click", connectSerial);
  $("#sendTxBtn").addEventListener("click", () => { sendSerial($("#txInput").value); $("#txInput").value = ""; }); $("#txInput").addEventListener("keydown", e => { if (e.key === "Enter") $("#sendTxBtn").click(); });
  $("#clearLogsBtn").addEventListener("click", () => { state.logs = []; $("#terminal").innerHTML = ""; }); $("#copyErrorBtn").addEventListener("click", () => { const error = [...state.logs].reverse().find(l => l.level === "err")?.message || "최근 통신 로그를 분석해줘"; $("#promptInput").value = `다음 하드웨어 통신 오류를 분석하고 수정 방법을 알려줘: ${error}`; toast("오류를 AI 프롬프트로 복사했습니다"); });
  $("#wifiBtn").addEventListener("click", () => $("#wifiDialog").showModal()); $("#sendWifiBtn").addEventListener("click", async e => { e.preventDefault(); if (!$("#wifiForm").reportValidity()) return; await sendSerial(`WIFI:${$("#ssidInput").value}:${$("#wifiPasswordInput").value}`); $("#wifiDialog").close(); toast("Wi-Fi 설정을 ESP32로 전송했습니다"); });
  $("#settingsBtn").addEventListener("click", () => { $("#providerSelect").value = state.provider; updateModelOptions(); $("#apiKeyInput").value = state.apiKey; $("#settingsDialog").showModal(); }); $("#providerSelect").addEventListener("change", updateModelOptions); $("#revealKeyBtn").addEventListener("click", () => { const input = $("#apiKeyInput"); input.type = input.type === "password" ? "text" : "password"; }); $("#testApiBtn").addEventListener("click", testApi);
  $("#saveSettingsBtn").addEventListener("click", e => { e.preventDefault(); state.provider = $("#providerSelect").value; state.model = $("#modelSelect").value; state.apiKey = $("#apiKeyInput").value.trim(); localStorage.setItem("phyvibe.provider", state.provider); localStorage.setItem("phyvibe.model", state.model); localStorage.setItem("phyvibe.apiKey", state.apiKey); $("#settingsDialog").close(); toast("AI 설정을 이 브라우저에 저장했습니다"); });
  $("#exportBtn").addEventListener("click", downloadProject); $("#shareBtn").addEventListener("click", () => { $("#shareUrl").value = location.href; $("#shareDialog").showModal(); }); $("#copyLinkBtn").addEventListener("click", () => navigator.clipboard.writeText($("#shareUrl").value).then(() => toast("링크를 복사했습니다"))); $("#nativeShareBtn").addEventListener("click", () => navigator.share ? navigator.share({ title: $("#projectName").value, url: location.href }) : $("#copyLinkBtn").click());
  $("#copyCodeBtn").addEventListener("click", () => navigator.clipboard.writeText($("#codeContent").textContent).then(() => toast("코드를 복사했습니다"))); $("#copySchemaBtn").addEventListener("click", () => navigator.clipboard.writeText($("#schemaContent").textContent).then(() => toast("스키마를 복사했습니다")));
  $("#refreshPreview").addEventListener("click", () => { renderWidgets(); toast("라이브 뷰를 새로고침했습니다"); }); $("#fullscreenBtn").addEventListener("click", () => $("#canvasPanel").requestFullscreen?.()); $("#newChatBtn").addEventListener("click", () => { $("#conversation").innerHTML = ""; appendMessage("ai", "새 프로젝트를 시작할 준비가 됐어요. 무엇을 만들까요?"); });
  $("#projectName").addEventListener("input", () => { $("#savedState").textContent = "편집 중"; clearTimeout(bindEvents.saveTimer); bindEvents.saveTimer = setTimeout(() => $("#savedState").textContent = "저장됨", 500); });
  $("#addHardwareBtn").addEventListener("click", () => toast("MVP에서는 서보, 초음파, DC 모터 프리셋을 지원합니다"));
  $("#retryQwenBtn").addEventListener("click", checkQwenConnection);
  $("#demoModeBtn").addEventListener("click", () => { state.provider = "demo"; state.model = "rule-engine"; localStorage.setItem("phyvibe.provider", "demo"); clearTimeout(qwenRetryTimer); $("#qwenStartupDialog").close(); toast("데모 모드로 시작했습니다"); });
  $("#qwenStartupDialog").addEventListener("cancel", event => event.preventDefault());
}

renderWidgets(); bindEvents();
addLog("SYS", "PHYVIBE runtime ready"); addLog("RX", '{"type":"sensor","k":"temperature","val":24.6}'); addLog("RX", '{"type":"sensor","k":"humidity","val":58}');
startQwenGate();
setInterval(() => {
  if (state.bridge?.readyState === WebSocket.OPEN || state.serialPort) return;
  const sensor = state.widgets.find(widget => ["soil", "sonar", "temperature", "humidity"].includes(widget.id));
  if (!sensor || typeof sensor.value !== "number") return;
  const next = Math.max(sensor.min || 0, Math.min(sensor.max || 100, sensor.value + (Math.random() * 4 - 2)));
  handlePacket(`DATA:${sensor.id}:${Number(next.toFixed(1))}`);
}, 5000);
