const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const defaultWidgets = [
  { id: "temperature", type: "metric", title: "현재 온도", icon: "🌡", value: 24.6, unit: "°C", min: 0, max: 40, trend: "+0.4°C", pin: "P0" },
  { id: "humidity", type: "gauge", title: "상대 습도", icon: "◌", value: 58, unit: "%", min: 0, max: 100, pin: "P1" },
  { id: "chart", type: "chart", title: "온도 변화", icon: "⌁", value: 24.6, unit: "°C", wide: true, points: [21, 24, 22, 28, 26, 31, 29, 35, 33, 39] },
  { id: "distance", type: "alert", title: "접근 감지", icon: "◉", value: 34, unit: "cm", threshold: 10, pin: "P2" },
  { id: "servo", type: "control", title: "서보 모터", icon: "↻", value: 90, unit: "°", min: 0, max: 180, pin: "P0" }
];

// Older versions defaulted to demo and persisted it without an explicit choice.
if (localStorage.getItem("phyvibe.providerVersion") !== "2") {
  if (!localStorage.getItem("phyvibe.provider") || localStorage.getItem("phyvibe.provider") === "demo") {
    localStorage.setItem("phyvibe.provider", "qwen");
  }
  localStorage.setItem("phyvibe.providerVersion", "2");
}

const state = {
  widgets: structuredClone(defaultWidgets),
  target: "widget",
  bridge: null,
  bridgeUrl: localStorage.getItem("phyvibe.bridgeUrl") || "http://localhost:5000",
  pollController: null,
  lastMessageId: 0,
  logs: [],
  generating: false,
  generationValid: false,
  provider: localStorage.getItem("phyvibe.provider") || "qwen",
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

let QWEN_BASE_URL = localStorage.getItem("phyvibe.llmUrl") || "http://127.0.0.1:8080";
let qwenRetryTimer = null;
let qwenConnectionPromise = null;

function checkQwenConnection() {
  if (!qwenConnectionPromise) {
    qwenConnectionPromise = performQwenConnection().finally(() => { qwenConnectionPromise = null; });
  }
  return qwenConnectionPromise;
}

async function performQwenConnection() {
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
    state.qwenModelId = null;
    status.textContent = "연결되지 않음";
    dot.className = "error";
    $("#qwenStartupMessage").textContent = error.message.includes("모델") ? error.message : `연결 실패: ${QWEN_BASE_URL} · ${error.message}. 서버 포트, 주소 및 브라우저 CORS 오류를 확인하세요.`;
    clearTimeout(qwenRetryTimer);
    if (state.provider === "qwen") qwenRetryTimer = setTimeout(checkQwenConnection, 3000);
    return false;
  } finally {
    updateProviderStatus();
  }
}

function updateProviderStatus() {
  const label = $("#activeProviderLabel");
  label.textContent = state.provider === "qwen" ? `Harness 3.1 · Local Qwen · ${QWEN_BASE_URL} · ${state.qwenModelId ? "연결 완료" : "연결 대기"}` : state.provider === "demo" ? "Harness 3.1 · 데모 모드 · LLM 요청 없음" : `${state.provider} · 웹앱 생성 미지원`;
}

async function configureQwenUrl(value) {
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("HTTP / HTTPS LLM 서버 주소를 입력하세요");
  // Finish a running discovery before changing its endpoint and cached model.
  if (qwenConnectionPromise) await qwenConnectionPromise;
  clearTimeout(qwenRetryTimer);
  const next = url.href.replace(/\/$/, "");
  if (next !== QWEN_BASE_URL) state.qwenModelId = null;
  QWEN_BASE_URL = next;
  localStorage.setItem("phyvibe.llmUrl", next);
  $("#llmUrlInput").value = next;
  $("#startupLlmUrlInput").value = next;
  updateProviderStatus();
}

function returnToLocalQwen() {
  state.provider = "qwen";
  state.model = "qwen3-8b";
  localStorage.setItem("phyvibe.provider", "qwen");
  updateProviderStatus();
  startQwenGate();
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

const HARNESS_SKILLS = {
  display_sensor: { description: "Display incoming DATA:key:value or sensor JSON", arguments: { key: "sensor key" } },
  send_text: { description: "Send an exact literal string through the network bridge", arguments: { text: "1–256 characters, no CR/LF; preserve case and whitespace" } },
  set_servo: { description: "Slider sends CMD:target:angle to micro:bit", arguments: { target: "servo, valve, or mouth", range: "0..180" } },
  set_motor: { description: "Slider sends CMD:motor:percent to micro:bit", arguments: { range: "0..80" } }
};

function normalizeWidgets(items) {
  const allowedTypes = new Set(["metric", "gauge", "chart", "alert", "control", "button"]);
  if (!Array.isArray(items) || items.length < 1 || items.length > 8) throw new Error("widgets must contain 1–8 widgets");
  const ids = new Set();
  return items.map((item, index) => {
    if (!item || !allowedTypes.has(item.type)) throw new Error(`widgets[${index}]: unsupported widget type`);
    if (typeof item.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(item.id) || ids.has(item.id.toLowerCase())) throw new Error(`widgets[${index}]: unique English id required`);
    ids.add(item.id.toLowerCase());
    const widget = { id: item.id, type: item.type, title: String(item.title || "센서 데이터"), icon: String(item.icon || "◇"), value: Number(item.value) || 0, unit: String(item.unit || ""), min: Number.isFinite(item.min) ? item.min : 0, max: Number.isFinite(item.max) ? item.max : 100, threshold: Number(item.threshold) || 10, wide: Boolean(item.wide), points: Array.isArray(item.points) ? item.points.filter(Number.isFinite).slice(0, 20) : undefined };
    if (item.type === "button") {
      // Qwen may wrap the same allowed skills in action.skills or a single action.
      const actions = item.actions ?? item.action?.skills ?? (item.action?.skill ? [item.action] : undefined);
      if (!Array.isArray(actions) || !actions.length || actions.length > 8) throw new Error(`${item.id}: button requires 1–8 actions`);
      widget.actions = actions.map(action => {
        if (action?.skill !== "send_text" || typeof action.text !== "string" || !action.text.trim() || action.text.length > 256 || /[\r\n]/.test(action.text)) throw new Error(`${item.id}: use send_text with a nonempty single-line text of at most 256 characters`);
        return { skill: "send_text", text: action.text };
      });
    } else if (item.type === "control") {
      const action = item.action;
      if (action?.skill === "set_servo" && ["servo", "valve", "mouth"].includes(action.target)) {
        widget.action = { skill: "set_servo", target: action.target }; widget.command = `CMD:${action.target}`;
        widget.min = Math.max(0, widget.min); widget.max = Math.min(180, widget.max);
      } else if (action?.skill === "set_motor") {
        widget.action = { skill: "set_motor" }; widget.command = "CMD:motor";
        widget.min = Math.max(0, widget.min); widget.max = Math.min(80, widget.max);
      } else throw new Error(`${item.id}: control requires set_servo or set_motor action`);
      if (widget.max <= widget.min) throw new Error(`${item.id}: invalid control range`);
      widget.value = Math.max(widget.min, Math.min(widget.max, widget.value));
    } else {
      if (item.action?.skill !== "display_sensor" || typeof item.action.key !== "string" || !/^[a-zA-Z0-9_-]+$/.test(item.action.key)) throw new Error(`${item.id}: sensor widget requires display_sensor with an English key`);
      widget.action = { skill: "display_sensor", key: item.action.key }; widget.sensorKey = item.action.key;
    }
    return widget;
  });
}

async function generateWithQwen(prompt) {
  if (!state.qwenModelId && !(await checkQwenConnection())) throw new Error("Qwen3 8B에 연결할 수 없습니다.");
  const system = `You are PHYVIBE's network webapp planner. Return JSON only; do not generate executable code. Use only the supplied skills and their arguments: ${JSON.stringify(HARNESS_SKILLS)}.
Button example (copy this structure for literal text requests): {"title":"Send a","widgets":[{"id":"send-a","type":"button","title":"Send a","actions":[{"skill":"send_text","text":"a"}]}]}.
Sensor example: {"title":"Temperature","widgets":[{"id":"temperature","type":"metric","title":"Temperature","action":{"skill":"display_sensor","key":"temperature"},"value":0,"unit":"°C"}]}.
Control example: {"title":"Servo","widgets":[{"id":"servo","type":"control","title":"Servo","action":{"skill":"set_servo","target":"servo"},"min":0,"max":180,"value":90}]}.
Optional widget fields: icon, value, unit, min, max, threshold, wide, points.
Create 1–8 widgets. metric/gauge/chart/alert must have action display_sensor. control must have action set_servo with target or set_motor. button must have actions:[{"skill":"send_text","text":"a"}] instead of action; actions execute in order. For a request to send literal 'a' on click, make a button whose send_text text is exactly "a". Never add CMD prefixes, numeric values, or newlines to literal text. Keep explicit user sensor keys and payloads exactly. Do not substitute a slider for a requested button.
The browser communicates with an HTTP bridge over Wi-Fi/Ethernet. ESP32 bridges Wi-Fi; micro:bit handles physical control and is programmed separately in MakeCode. No serial/USB or provisioning. /no_think`;
  const messages = [{ role: "system", content: system }, { role: "user", content: prompt }];
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(`${QWEN_BASE_URL}/v1/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: state.qwenModelId, stream: false, messages, temperature: 0.2 }),
      signal: AbortSignal.timeout(120000)
    });
    if (!response.ok) throw new Error(`Qwen 요청 실패 (HTTP ${response.status})`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    try {
      const result = extractJson(content);
      return { title: String(result.title || "피지컬 AI 대시보드"), widgets: normalizeWidgets(result.widgets) };
    } catch (error) {
      if (attempt === 1) throw new Error(`생성 하네스 검증 실패: ${error.message}`);
      messages.push({ role: "assistant", content }, { role: "user", content: `Your plan failed validation: ${error.message}. Correct the JSON using only the supported skills. Preserve the original user's literal payloads and sensor keys. Return the entire corrected plan.` });
    }
  }
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ],
  );
}

function renderWidget(widget) {
  const wide = widget.wide ? " wide" : "";
  const warning =
    widget.type === "alert" && Number(widget.value) <= Number(widget.threshold)
      ? " warning"
      : "";
  const head = `<div class="widget-head"><span>${escapeHtml(widget.title)}</span><span class="widget-icon">${escapeHtml(widget.icon || "◇")}</span></div>`;
  if (widget.type === "button") {
    const commands = escapeHtml(
      JSON.stringify(widget.actions.map((action) => action.text)),
    );
    return `<article class="widget${wide}" data-widget="${widget.id}">${head}<button class="widget-action primary" data-commands="${commands}">${escapeHtml(widget.title)}</button></article>`;
  }
  if (widget.type === "chart") {
    const pts = widget.points || [20, 25, 23, 32, 28, 35];
    const max = Math.max(...pts),
      min = Math.min(...pts);
    const points = pts
      .map(
        (v, i) =>
          `${(i / (pts.length - 1)) * 100},${55 - ((v - min) / Math.max(1, max - min)) * 45}`,
      )
      .join(" ");
    return `<article class="widget${wide}" data-widget="${widget.id}">${head}<div class="chart"><svg viewBox="0 0 100 60" preserveAspectRatio="none"><defs><linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#3988e8"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><path class="chart-grid" d="M0 15H100M0 30H100M0 45H100"/><polygon class="chart-fill" points="0,60 ${points} 100,60"/><polyline class="chart-line" points="${points}"/></svg></div><div class="widget-main"><span class="widget-value">${escapeHtml(widget.value)}</span><span class="widget-unit">${escapeHtml(widget.unit)}</span><span class="trend">실시간</span></div></article>`;
  }
  if (widget.type === "gauge") {
    const ratio = Math.min(
      100,
      Math.max(
        0,
        ((Number(widget.value) - Number(widget.min || 0)) /
          Math.max(1, Number(widget.max || 100) - Number(widget.min || 0))) *
          100,
      ),
    );
    const status =
      Number(widget.value) < Number(widget.threshold || -Infinity)
        ? "주의"
        : "정상";
    return `<article class="widget${wide}${status === "주의" ? " warning" : ""}" data-widget="${widget.id}">${head}<div class="gauge" style="--gauge-value:${ratio}%"></div><div class="widget-main"><span class="widget-value">${escapeHtml(widget.value)}</span><span class="widget-unit">${escapeHtml(widget.unit)}</span><span class="trend">${status}</span></div></article>`;
  }
  if (widget.type === "control") {
    const command =
      widget.command === "MOT"
        ? `MOT:${escapeHtml(widget.value)}:${escapeHtml(widget.value)}`
        : `${widget.command || `CMD:${widget.id}`}:${escapeHtml(widget.value)}`;
    const stop =
      widget.command === "MOT"
        ? "MOT:0:0"
        : `${widget.command || `CMD:${widget.id}`}:0`;
    return `<article class="widget${wide}" data-widget="${widget.id}">${head}<div class="widget-main"><span class="widget-value" data-control-value>${escapeHtml(widget.value)}</span><span class="widget-unit">${escapeHtml(widget.unit)}</span></div><div class="slider-row"><span>${widget.min}</span><input type="range" min="${widget.min}" max="${widget.max}" value="${escapeHtml(widget.value)}" data-control="${widget.id}"><span>${widget.max}</span></div><div class="action-row"><button class="widget-action" data-command="${stop}">정지</button><button class="widget-action primary" data-command="${command}">적용</button></div></article>`;
  }
  return `<article class="widget${wide}${warning}" data-widget="${widget.id}">${head}<div class="widget-main"><span class="widget-value">${escapeHtml(widget.value)}</span><span class="widget-unit">${escapeHtml(widget.unit)}</span>${widget.trend ? `<span class="trend">${escapeHtml(widget.trend)}</span>` : ""}</div><div class="meter"><i style="width:${Math.min(100, Math.max(3, ((widget.value - (widget.min || 0)) / ((widget.max || 100) - (widget.min || 0))) * 100))}%"></i></div>${widget.type === "alert" ? `<div class="action-row"><span class="widget-action">기준 ${widget.threshold}${escapeHtml(widget.unit)}</span></div>` : ""}</article>`;
}

function renderWidgets() {
  $("#widgetGrid").innerHTML = state.widgets.map(renderWidget).join("");
  $("#schemaContent").textContent = JSON.stringify({ version: 3, skills: HARNESS_SKILLS, network: { transport: "http", bridgeUrl: state.bridgeUrl, statusPath: "/api/status", commandPath: "/api/command" }, title: $("#dashboardTitle").textContent, widgets: state.widgets }, null, 2);
  const project = { title: $("#dashboardTitle").textContent, network: { transport: "http", bridgeUrl: state.bridgeUrl }, widgets: state.widgets };
  $("#codeContent").textContent = `${escapeHtml.toString()}\n${renderWidget.toString()}\n(${userAppRuntime.toString()})(${JSON.stringify(project, null, 2)});`;
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
  if (/모터|팬|motor/.test(p)) widgets.push({ id: "motor", type: "control", title: "DC 모터 속도", icon: "⚙", value: 50, unit: "%", min: 0, max: 80, pin: "micro:bit" });
  if (/서보|servo/.test(p)) widgets.push({ id: "servo", type: "control", title: "서보 각도", icon: "↻", value: 90, unit: "°", min: 0, max: 180, pin: "P0" });
  if (/조도|빛|light/.test(p)) widgets.push({ id: "light", type: "metric", title: "주변 조도", icon: "☀", value: 72, unit: "%", min: 0, max: 100, pin: "P1" });
  if (/차트|그래프|변화|모니터/.test(p)) widgets.push({ id: "chart", type: "chart", title: "센서 변화", icon: "⌁", value: 24.6, unit: "", wide: true, points: [20, 24, 22, 29, 26, 33, 31, 38] });
  return widgets.length ? widgets : [{ id: "sensor", type: "metric", title: "센서 데이터", icon: "◇", value: 42, unit: "", min: 0, max: 100, pin: "P0" }];
}

async function generate() {
  const input = $("#promptInput"); const prompt = input.value.trim();
  if (!prompt || state.generating) return;
  state.generating = true; state.generationValid = false; $("#exportBtn").disabled = true; $("#generateBtn").disabled = true; appendMessage("user", prompt); input.value = "";
  const typing = appendMessage("ai", "요청을 분석하고 하드웨어 안전 규칙을 적용하는 중…", true);
  if (state.target === "widget") {
    try {
      if (!["qwen", "demo"].includes(state.provider)) throw new Error("이 공급자의 웹앱 생성은 아직 지원되지 않습니다. AI 설정에서 Local Qwen을 선택하세요.");
      const generated = state.provider === "qwen"
        ? await generateWithQwen(prompt)
        : { title: /화분|토양/.test(prompt) ? "잔소리 식물 화분" : /터틀|자율주행/.test(prompt) ? "자율주행 터틀 컨트롤" : (prompt.length > 20 ? "새 피지컬 AI 대시보드" : prompt.replace(/만들어줘|보여줘|해줘/g, "").trim()), widgets: widgetsFromPrompt(prompt) };
      state.widgets = generated.widgets;
      state.generationValid = true; $("#exportBtn").disabled = false;
      $("#dashboardTitle").textContent = generated.title;
      renderWidgets();
      typing.querySelector("div:last-child").classList.remove("typing");
      typing.querySelector("p").textContent = `${state.provider === "qwen" ? "로컬 Qwen이 " : "데모 규칙 엔진이 (LLM 요청 없음) "}${state.widgets.length}개의 위젯을 생성했어요. 지원 스킬과 네트워크 동작을 적용했습니다.`;
    } catch (error) {
      typing.querySelector("div:last-child").classList.remove("typing");
      typing.querySelector("p").textContent = `생성 실패: ${error.message}`;
      state.generating = false;
      $("#generateBtn").disabled = false;
      if (state.provider === "qwen" && !state.qwenModelId) startQwenGate();
      return;
    }
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
    const widget = state.widgets.find(w => (w.sensorKey || w.id).toLowerCase() === key.toLowerCase());
    if (widget) { widget.value = value; if (widget.points) widget.points = [...widget.points.slice(-11), Number(value) || 0]; renderWidgets(); }
    $("#lastUpdated").textContent = "방금 전";
    return;
  }
  try {
    const packet = JSON.parse(raw);
    if (packet.type === "sensor") {
      const widget = state.widgets.find(w => (w.sensorKey || w.id) === packet.k); if (widget) { widget.value = packet.val; renderWidgets(); }
      $("#lastUpdated").textContent = "방금 전";
    }
  } catch { /* Keep unstructured network data visible in the monitor. */ }
}

function toggleBridge(enabled) {
  state.pollController?.abort();
  state.pollController = null;
  state.bridge = null;
  $("#gatewayValue").textContent = "—";
  $("#clientCountValue").textContent = "—";
  $("#rttValue").textContent = "—";
  if (!enabled) { setConnection("", "네트워크 대기 중", "연결이 중지되었습니다"); return; }
  try {
    const url = new URL($("#bridgeUrlInput").value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("HTTP 또는 HTTPS 서버 URL을 입력하세요");
    state.bridgeUrl = url.href.replace(/\/$/, "");
    localStorage.setItem("phyvibe.bridgeUrl", state.bridgeUrl);
  } catch (error) { $("#bridgeToggle").checked = false; setConnection("error", "URL 확인", error.message); return; }
  state.lastMessageId = 0;
  const controller = new AbortController(); state.pollController = controller;
  renderWidgets();
  setConnection("", "네트워크 연결 중", state.bridgeUrl);
  addLog("SYS", `HTTP bridge: ${state.bridgeUrl}`);
  async function poll() {
    if (controller.signal.aborted) return;
    try {
      const started = performance.now();
      const response = await fetch(`${state.bridgeUrl}/api/status`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const status = await response.json();
      if (controller.signal.aborted) return;
      state.bridge = true;
      setConnection("online", "서버 연결 완료", `${state.bridgeUrl} · 수신 ${status.message_sequence || 0}건 · ESP32 명령 연결 ${status.connected_clients}대`);
      $("#gatewayValue").textContent = new URL(state.bridgeUrl).host;
      $("#clientCountValue").textContent = status.connected_clients;
      $("#rttValue").textContent = `${Math.round(performance.now() - started)} ms`;
      for (const item of [...(status.message_history || [])].reverse()) {
        if (item.id > state.lastMessageId) {
          String(item.message).split(/\r?\n/).filter(Boolean).forEach(handlePacket);
          state.lastMessageId = item.id;
        }
      }
      if (Number(status.message_sequence) < state.lastMessageId) state.lastMessageId = 0;
    } catch (error) {
      if (controller.signal.aborted) return;
      if (state.bridge !== false) addLog("ERR", `HTTP network: ${error.message}`, "err");
      state.bridge = false;
      setConnection("error", "서버 연결 실패", "서버 주소와 네트워크를 확인하세요 · 자동 재시도");
      $("#clientCountValue").textContent = "—";
    }
    if (!controller.signal.aborted) setTimeout(poll, 1000);
  }
  poll();
}

async function sendNetwork(text, literal = false) {
  let value = text; if (typeof value !== "string" || !value.trim()) return false;
  const servo = value.match(/^CMD:(servo|valve|mouth):(-?\d+(?:\.\d+)?)$/i);
  if (servo && !literal) {
    const safeAngle = Math.min(180, Math.max(0, Number(servo[2])));
    if (safeAngle !== Number(servo[2])) addLog("SAFE", `서보 각도 ${servo[2]}° → ${safeAngle}° 클램핑`);
    value = `CMD:${servo[1]}:${safeAngle}`;
  }
  const motor = value.match(/^MOT:(-?\d+):(-?\d+)$/i);
  if (motor && !literal) {
    const left = Math.min(255, Math.max(-255, Number(motor[1]))), right = Math.min(255, Math.max(-255, Number(motor[2])));
    value = `MOT:${left}:${right}`;
    if (left !== Number(motor[1]) || right !== Number(motor[2])) addLog("SAFE", `모터 PWM을 -255~255로 제한: ${value}`);
  }
  if (!state.bridge) { toast("네트워크 서버를 먼저 연결하세요"); return false; }
  try {
    const response = await fetch(`${state.bridgeUrl}/api/command`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: value }), signal: AbortSignal.timeout(5000)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    addLog("TX", `${value} · ESP32 ${result.sent_count}대에 전달`);
    return true;
  } catch (error) { addLog("ERR", `명령 전송 실패: ${error.message}`, "err"); toast("네트워크 명령 전송 실패"); return false; }
}

function userAppRuntime(project) {
  const grid = document.querySelector("#widgetGrid");
  const status = document.querySelector("#status");
  const monitor = document.querySelector("#monitor");
  const endpoint = document.querySelector("#endpoint");
  endpoint.value = project.network.bridgeUrl;
  let controller,
    lastId = 0;
  function log(text) {
    monitor.textContent = (monitor.textContent + text + "\n")
      .split("\n")
      .slice(-80)
      .join("\n");
  }
  function render() {
    grid.innerHTML = project.widgets.map(renderWidget).join("");
  }
  async function send(command, literal = false) {
    if (!controller || controller.signal.aborted) {
      status.textContent = "서버를 먼저 연결하세요";
      return;
    }
    try {
      const servo = command.match(
        /^CMD:(servo|valve|mouth):(-?\d+(?:\.\d+)?)$/i,
      );
      if (servo && !literal)
        command = `CMD:${servo[1]}:${Math.max(0, Math.min(180, Number(servo[2])))}`;
      const motor = command.match(/^MOT:(-?\d+):(-?\d+)$/i);
      if (motor && !literal)
        command = `MOT:${Math.max(-255, Math.min(255, Number(motor[1])))}:${Math.max(-255, Math.min(255, Number(motor[2])))}`;
      const response = await fetch(`${project.network.bridgeUrl}/api/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
        signal: AbortSignal.timeout(5000),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || `HTTP ${response.status}`);
      log(`TX ${command} · ESP32 ${result.sent_count}`);
      return true;
    } catch (error) {
      log(`ERR ${error.message}`);
      status.textContent = "명령 전송 실패";
      return false;
    }
  }
  document.querySelector("#connect").onclick = () => {
    controller?.abort();
    lastId = 0;
    try {
      const url = new URL(endpoint.value.trim());
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error("HTTP / HTTPS URL을 입력하세요");
      project.network.bridgeUrl = url.href.replace(/\/$/, "");
    } catch (error) {
      status.textContent = error.message;
      return;
    }
    const current = new AbortController();
    controller = current;
    async function poll() {
      if (current.signal.aborted) return;
      try {
        const response = await fetch(
          `${project.network.bridgeUrl}/api/status`,
          {
            cache: "no-store",
            signal: AbortSignal.any([
              current.signal,
              AbortSignal.timeout(5000),
            ]),
          },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (current.signal.aborted) return;
        status.textContent = `서버 연결 완료 · 수신 ${data.message_sequence || 0}건 · ESP32 명령 연결 ${data.connected_clients}대`;
        if (data.message_sequence < lastId) lastId = 0;
        for (const item of [...(data.message_history || [])].reverse()) {
          if (item.id <= lastId) continue;
          for (const line of String(item.message)
            .split(/\r?\n/)
            .filter(Boolean)) {
            log(`RX ${line}`);
            const match = line.match(/^DATA:([^:]+):(.+)$/i);
            let key, value;
            if (match) {
              key = match[1];
              value = Number.isFinite(Number(match[2]))
                ? Number(match[2])
                : match[2];
            } else {
              try {
                const packet = JSON.parse(line);
                if (packet.type === "sensor") {
                  key = packet.k;
                  value = packet.val;
                }
              } catch {}
            }
            const widget = project.widgets.find(
              (w) =>
                (w.sensorKey || w.id).toLowerCase() ===
                String(key).toLowerCase(),
            );
            if (widget) {
              widget.value = value;
              if (widget.points && Number.isFinite(Number(value)))
                widget.points = [...widget.points.slice(-11), Number(value)];
            } else if (key !== undefined)
              log(
                `INFO 센서 키 "${key}"와 일치하는 위젯 없음. 사용 가능한 키: ${project.widgets.map((w) => w.id).join(", ")}`,
              );
            else
              log(
                "INFO 위젯 업데이트 형식: DATA:<센서키>:<값> 또는 sensor JSON",
              );
          }
          lastId = item.id;
        }
        render();
      } catch (error) {
        if (current.signal.aborted) return;
        status.textContent = `연결 실패 · ${error.message} · 자동 재시도`;
      }
      if (!current.signal.aborted) setTimeout(poll, 1000);
    }
    poll();
  };
  document.querySelector("#disconnect").onclick = () => {
    controller?.abort();
    status.textContent = "연결 중지";
  };
  grid.addEventListener("input", (e) => {
    if (!e.target.matches("[data-control]")) return;
    const widget = project.widgets.find(
      (w) => w.id === e.target.dataset.control,
    );
    widget.value = Math.max(
      widget.min,
      Math.min(widget.max, Number(e.target.value)),
    );
    e.target
      .closest(".widget")
      .querySelector("[data-control-value]").textContent = widget.value;
  });
  grid.addEventListener("click", (e) => {
    if (e.target.dataset.commands) {
      (async () => {
        for (const command of JSON.parse(e.target.dataset.commands)) {
          if (!(await send(command, true))) break;
        }
      })();
      return;
    }
    let command = e.target.dataset.command;
    if (!command) return;
    const current = e.target
      .closest(".widget")
      ?.querySelector("[data-control-value]")?.textContent;
    if (current && !/:0(?::0)?$/.test(command))
      command = command.startsWith("MOT:")
        ? `MOT:${current}:${current}`
        : command.replace(/:-?\d+(?:\.\d+)?$/, `:${current}`);
    send(command);
  });
  render();
}

function downloadProject() {
  if (!state.generationValid || state.generating) { toast("먼저 웹앱을 성공적으로 생성하세요. 이전 결과는 새 웹앱으로 내보낼 수 없습니다."); return; }
  const project = { version: 3, harnessVersion: "3.1", name: $("#projectName").value, title: $("#dashboardTitle").textContent, network: { transport: "http", bridgeUrl: state.bridgeUrl }, widgets: state.widgets };
  const json = JSON.stringify(project, null, 2).replace(/</g, "\\u003c");
  const script = `// Display helpers\n${escapeHtml.toString()}\n\n${renderWidget.toString()}\n\n// Network connection, sensor updates, and button actions\n${userAppRuntime.toString()}\n\n// Generated dashboard configuration\nconst dashboardProject = ${json};\n\n// Start the dashboard\nuserAppRuntime(dashboardProject);`;
  const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(project.title)}</title>

  <!-- Dashboard appearance -->
  <style>
    body {
      font-family: system-ui;
      margin: 24px;
      background: #eff4fa;
      color: #14243a;
    }

    input,button {
      padding: 10px;
      margin: 4px;
    }

    #endpoint {
      width: min(70%,400px);
    }

    .widget-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit,minmax(240px,1fr));
      gap: 16px;
    }

    .widget {
      background: white;
      padding: 20px;
      border-radius: 12px;
    }

    .widget-head,.widget-main,.slider-row,.action-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin: 12px 0;
    }

    .widget-value {
      font-size: 30px;
    }

    .chart svg {
      width: 100%;
      height: 100px;
    }

    .chart-line {
      fill: none;
      stroke: #3988e8;
      stroke-width: 2;
    }

    .chart-fill {
      fill: #3988e822;
    }

    .warning {
      border: 2px solid #e7a12b;
    }

    pre {
      background: #14243a;
      color: #c6e7ff;
      padding: 16px;
      white-space: pre-wrap;
      max-height: 220px;
      overflow: auto;
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(project.title)}</h1>
  <p>Wi-Fi / Ethernet → 서버 → ESP32 Wi-Fi 브릿지 → micro:bit 컨트롤러</p>

  <!-- Network connection controls -->
  <input id="endpoint" aria-label="브릿지 서버 URL">
  <button id="connect">연결</button>
  <button id="disconnect">연결 중지</button>
  <p id="status">네트워크 대기 중</p>

  <!-- Widgets are rendered from dashboardProject below -->
  <main id="widgetGrid" class="widget-grid"></main>

  <!-- Received network data and outgoing commands -->
  <h2>Wi-Fi 데이터 모니터</h2>
  <pre id="monitor"></pre>

  <script>
${script.split("\n").map(line => line ? `    ${line}` : "").join("\n")}
  <\/script>
</body>
</html>
`;
  const blob = new Blob([html], { type: "text/html" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "phyvibe-webapp.html"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("독립 실행 네트워크 웹앱을 내보냈습니다");
}

function updateModelOptions() {
  const provider = $("#providerSelect").value; $("#modelSelect").innerHTML = modelOptions[provider].map(m => `<option value="${m.value}">${m.label}</option>`).join("");
  if (modelOptions[provider].some(m => m.value === state.model)) $("#modelSelect").value = state.model;
}

async function testApi() {
  const provider = $("#providerSelect").value, key = $("#apiKeyInput").value.trim(), result = $("#testResult");
  if (provider === "qwen") {
    result.className = "test-result"; result.textContent = "연결 확인 중…";
    try { await configureQwenUrl($("#llmUrlInput").value); } catch (error) { result.className = "test-result error"; result.textContent = error.message; return; }
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
    if (e.target.dataset.commands) {
      (async () => { for (const command of JSON.parse(e.target.dataset.commands)) { if (!(await sendNetwork(command, true))) break; } })();
      return;
    }
    const command = e.target.dataset.command; if (!command) return;
    const current = e.target.closest(".widget")?.querySelector("[data-control-value]")?.textContent;
    if (!current || /:0(?::0)?$/.test(command)) return sendNetwork(command);
    sendNetwork(command.startsWith("MOT:") ? `MOT:${current}:${current}` : command.replace(/:-?\d+(?:\.\d+)?$/, `:${current}`));
  });
  $("#bridgeUrlInput").addEventListener("change", () => { if ($("#bridgeToggle").checked) toggleBridge(true); });
  $("#bridgeToggle").addEventListener("change", e => toggleBridge(e.target.checked));
  $("#sendTxBtn").addEventListener("click", () => { sendNetwork($("#txInput").value); $("#txInput").value = ""; }); $("#txInput").addEventListener("keydown", e => { if (e.key === "Enter") $("#sendTxBtn").click(); });
  $("#clearLogsBtn").addEventListener("click", () => { state.logs = []; $("#terminal").innerHTML = ""; }); $("#copyErrorBtn").addEventListener("click", () => { const error = [...state.logs].reverse().find(l => l.level === "err")?.message || "최근 통신 로그를 분석해줘"; $("#promptInput").value = `다음 Wi-Fi / Ethernet 네트워크 통신 오류를 분석하고 수정 방법을 알려줘: ${error}`; toast("오류를 AI 프롬프트로 복사했습니다"); });
  $("#settingsBtn").addEventListener("click", () => { $("#providerSelect").value = state.provider; $("#llmUrlInput").value = QWEN_BASE_URL; updateModelOptions(); $("#apiKeyInput").value = state.apiKey; $("#settingsDialog").showModal(); }); $("#providerSelect").addEventListener("change", updateModelOptions); $("#revealKeyBtn").addEventListener("click", () => { const input = $("#apiKeyInput"); input.type = input.type === "password" ? "text" : "password"; }); $("#testApiBtn").addEventListener("click", testApi);
  $("#saveSettingsBtn").addEventListener("click", async e => { e.preventDefault(); if ($("#providerSelect").value === "qwen") { try { await configureQwenUrl($("#llmUrlInput").value); } catch (error) { toast(error.message); return; } } state.provider = $("#providerSelect").value; state.model = $("#modelSelect").value; state.apiKey = $("#apiKeyInput").value.trim(); localStorage.setItem("phyvibe.provider", state.provider); localStorage.setItem("phyvibe.model", state.model); localStorage.setItem("phyvibe.apiKey", state.apiKey); $("#settingsDialog").close(); clearTimeout(qwenRetryTimer); updateProviderStatus(); if (state.provider === "qwen") startQwenGate(); toast("AI 설정을 이 브라우저에 저장했습니다"); });
  $("#exportBtn").addEventListener("click", downloadProject); $("#shareBtn").addEventListener("click", () => { $("#shareUrl").value = location.href; $("#shareDialog").showModal(); }); $("#copyLinkBtn").addEventListener("click", () => navigator.clipboard.writeText($("#shareUrl").value).then(() => toast("링크를 복사했습니다"))); $("#nativeShareBtn").addEventListener("click", () => navigator.share ? navigator.share({ title: $("#projectName").value, url: location.href }) : $("#copyLinkBtn").click());
  $("#copyCodeBtn").addEventListener("click", () => navigator.clipboard.writeText($("#codeContent").textContent).then(() => toast("코드를 복사했습니다"))); $("#copySchemaBtn").addEventListener("click", () => navigator.clipboard.writeText($("#schemaContent").textContent).then(() => toast("스키마를 복사했습니다")));
  $("#refreshPreview").addEventListener("click", () => { renderWidgets(); toast("라이브 뷰를 새로고침했습니다"); }); $("#fullscreenBtn").addEventListener("click", () => $("#canvasPanel").requestFullscreen?.()); $("#newChatBtn").addEventListener("click", () => { $("#conversation").innerHTML = ""; appendMessage("ai", "새 프로젝트를 시작할 준비가 됐어요. 무엇을 만들까요?"); });
  $("#projectName").addEventListener("input", () => { $("#savedState").textContent = "편집 중"; clearTimeout(bindEvents.saveTimer); bindEvents.saveTimer = setTimeout(() => $("#savedState").textContent = "저장됨", 500); });
  $("#addHardwareBtn").addEventListener("click", () => toast("MVP에서는 서보, 초음파, DC 모터 프리셋을 지원합니다"));
  $("#returnToQwenBtn").addEventListener("click", returnToLocalQwen);
  $("#retryQwenBtn").addEventListener("click", async () => {
    try { await configureQwenUrl($("#startupLlmUrlInput").value); returnToLocalQwen(); }
    catch (error) { $("#qwenStartupMessage").textContent = error.message; }
  });
  $("#demoModeBtn").addEventListener("click", () => { state.provider = "demo"; state.model = "rule-engine"; localStorage.setItem("phyvibe.provider", "demo"); clearTimeout(qwenRetryTimer); $("#qwenStartupDialog").close(); updateProviderStatus(); toast("데모 모드 · LLM 요청 없이 실행합니다"); });
  $("#qwenStartupDialog").addEventListener("cancel", event => event.preventDefault());
}

renderWidgets(); bindEvents();
$("#exportBtn").disabled = true;
$("#bridgeUrlInput").value = state.bridgeUrl;
$("#llmUrlInput").value = QWEN_BASE_URL;
$("#startupLlmUrlInput").value = QWEN_BASE_URL;
addLog("SYS", "Network monitor ready · received network packets only");
updateProviderStatus();
startQwenGate();
