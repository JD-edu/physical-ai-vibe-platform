/**
 * PhyVibe Studio의 생성 하네스와 화면 실행 코드.
 *
 * 주요 흐름:
 * 1. Qwen 연결을 확인하고 사용자 요청을 JSON 위젯 계획으로 받습니다.
 * 2. 스킬, 장치 명령, 모터 슬라이더 참조와 카메라 입력을 검증합니다.
 * 3. 검증된 위젯을 표시하고 브릿지 또는 ESP32 카메라에 연결합니다.
 * 4. 실행에 필요한 함수와 설정을 독립 HTML 웹앱에 포함합니다.
 *
 * 카메라 프레임과 CNN 처리는 camera.js / vision.js가 담당합니다.
 * 스킬 설명은 skills.js의 SKILL_CATALOG를 공통으로 사용합니다.
 */

// DOM 조회 도우미. 여러 요소를 조회할 때는 배열로 변환합니다.
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// Older versions defaulted to demo and persisted it without an explicit choice.
if (localStorage.getItem("phyvibe.providerVersion") !== "2") {
  if (
    !localStorage.getItem("phyvibe.provider") ||
    localStorage.getItem("phyvibe.provider") === "demo"
  ) {
    localStorage.setItem("phyvibe.provider", "qwen");
  }
  localStorage.setItem("phyvibe.providerVersion", "2");
}

// 에디터의 세션 상태. 사용자 설정 일부는 localStorage에서 복원합니다.
const state = {
  widgets: [],
  cameraUrl: localStorage.getItem("phyvibe.cameraUrl") || "",
  target: "widget",
  deviceProfile: localStorage.getItem("phyvibe.deviceProfile") || "legacy",
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
  apiKey: localStorage.getItem("phyvibe.apiKey") || "",
};

// 설정 화면의 모델 선택 목록. 실제 웹앱 생성은 Qwen과 데모를 지원합니다.
const modelOptions = {
  demo: [{ value: "rule-engine", label: "내장 데모 엔진 (API 키 불필요)" }],
  qwen: [{ value: "qwen3-8b", label: "Qwen3 8B (llama.cpp)" }],
  openai: [
    { value: "gpt-4o-mini", label: "GPT-4o mini" },
    { value: "gpt-4o", label: "GPT-4o" },
  ],
  gemini: [
    { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
    { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
  ],
};

let QWEN_BASE_URL = localStorage.getItem("phyvibe.llmUrl") || "http://127.0.0.1:8080";
let qwenRetryTimer = null;
let qwenConnectionPromise = null;

// 동시에 들어오는 모델 조회 요청을 하나의 진행 중인 Promise로 공유합니다.
function checkQwenConnection() {
  if (!qwenConnectionPromise) {
    qwenConnectionPromise = performQwenConnection().finally(() => {
      qwenConnectionPromise = null;
    });
  }
  return qwenConnectionPromise;
}

// llama.cpp의 모델 목록을 조회하고 연결 표시와 재시도 상태를 갱신합니다.
async function performQwenConnection() {
  const status = $("#qwenStatusText");
  const dot = $("#qwenStatusDot");
  status.textContent = "Qwen3 8B 연결 확인 중";
  dot.className = "";
  try {
    const response = await fetch(`${QWEN_BASE_URL}/v1/models`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`llama.cpp HTTP ${response.status}`);
    const data = await response.json();
    const models = Array.isArray(data.data) ? data.data : [];
    const loaded = models.find((item) => /qwen/i.test(item.id || "")) || models[0];
    if (!loaded?.id) throw new Error("llama.cpp에 로드된 모델이 없습니다.");
    state.qwenModelId = loaded.id;
    status.textContent = "Qwen3 8B 연결 완료";
    dot.className = "online";
    $("#qwenStartupMessage").textContent =
      `${state.qwenModelId} 모델이 준비되었습니다. 스튜디오를 시작합니다.`;
    clearTimeout(qwenRetryTimer);
    setTimeout(() => $("#qwenStartupDialog").open && $("#qwenStartupDialog").close(), 450);
    return true;
  } catch (error) {
    state.qwenModelId = null;
    status.textContent = "연결되지 않음";
    dot.className = "error";
    $("#qwenStartupMessage").textContent = error.message.includes("모델")
      ? error.message
      : `연결 실패: ${QWEN_BASE_URL} · ${error.message}. 서버 포트, 주소 및 브라우저 CORS 오류를 확인하세요.`;
    clearTimeout(qwenRetryTimer);
    if (state.provider === "qwen") qwenRetryTimer = setTimeout(checkQwenConnection, 3000);
    return false;
  } finally {
    updateProviderStatus();
  }
}

// 현재 공급자와 Qwen 연결 상태를 프롬프트 영역에 표시합니다.
function updateProviderStatus() {
  const label = $("#activeProviderLabel");
  label.textContent =
    state.provider === "qwen"
      ? `Harness 3.2 · Local Qwen · ${QWEN_BASE_URL} · ${state.qwenModelId ? "연결 완료" : "연결 대기"}`
      : state.provider === "demo"
        ? "Harness 3.2 · 데모 모드 · LLM 요청 없음"
        : `${state.provider} · 웹앱 생성 미지원`;
}

// LLM 주소를 검증하고 저장합니다. 주소 변경 전 진행 중인 조회를 마칩니다.
async function configureQwenUrl(value) {
  const url = new URL(value.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("HTTP / HTTPS LLM 서버 주소를 입력하세요");
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

// 공급자를 로컬 Qwen으로 바꾸고 연결 확인 화면을 엽니다.
function returnToLocalQwen() {
  state.provider = "qwen";
  state.model = "qwen3-8b";
  localStorage.setItem("phyvibe.provider", "qwen");
  updateProviderStatus();
  startQwenGate();
}

// Qwen 사용 시 모델 준비 상태를 확인하는 시작 대화상자를 표시합니다.
function startQwenGate() {
  if (state.provider !== "qwen") return;
  const dialog = $("#qwenStartupDialog");
  if (!dialog.open) dialog.showModal();
  checkQwenConnection();
}

// 모델의 설명용 태그와 코드 펜스를 제거한 뒤 JSON 객체를 추출합니다.
function extractJson(text) {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Qwen 응답에서 JSON을 찾지 못했습니다.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

// 생성 프롬프트와 검증이 함께 사용하는 스킬 목록과 화면별 비전 런타임입니다.
const HARNESS_SKILLS = { ...SKILL_CATALOG.skills, ...SKILL_CATALOG.browserSkills };
const studioVision = createVisionRuntime((text, literal) => sendNetwork(text, literal));
const studioCamera = createVisionRuntime(async () => false);

// 오른쪽 ESP32 미리보기를 구성합니다. 영상은 브라우저가 직접 받습니다.
function renderStudioCamera() {
  studioCamera.render($("#esp32CameraPreview"), [
    {
      id: "studio-esp32-camera",
      type: "camera_stream",
      title: "카메라 미리보기",
      action: { skill: "camera_stream", source: { type: "esp32_stream", url: state.cameraUrl } },
    },
  ]);
}

// ESP32 카메라 요청에서 명시한 주소 또는 에디터에 저장된 주소를 선택합니다.
function requestedCameraSource(prompt) {
  const visionRequest = /카메라|영상|이미지|cnn|비전|camera|image|classif|vision/i.test(prompt);
  if (!visionRequest) return null;
  if (/웹캠|webcam|(?:pc|노트북|내장)\s*카메라/i.test(prompt)) return { type: "webcam" };
  const explicitESP32 = /esp32|와이파이|wifi|네트워크/i.test(prompt);
  const match = prompt.match(/https?:\/\/[^\s<>"']+/i);
  if (explicitESP32 || match || state.cameraUrl) {
    return normalizeVisionSource({ type: "esp32_stream", url: match ? match[0] : state.cameraUrl });
  }
  return null;
}

// 카메라 요청의 종류와 주소가 실제 생성 계획에도 반영됐는지 검사합니다.
function validateCameraPlan(widgets, prompt, source) {
  const visionRequested = widgets.some((w) => ["classifier", "camera_stream"].includes(w.type));
  if (
    visionRequested &&
    /\b(?:ViT|YOLO|OCR)\b|객체\s*검출|바운딩\s*박스|분할\s*마스크/i.test(prompt)
  ) {
    throw new Error(
      "현재 비전 스킬은 MobileNet CNN 이미지 분류를 지원합니다. ViT/객체 검출/OCR/분할은 아직 지원하지 않습니다.",
    );
  }
  if (!source) return widgets;
  const cameras = widgets.filter((w) => ["classifier", "camera_stream"].includes(w.type));
  if (!cameras.length)
    throw new Error("The ESP32 camera request requires a camera_stream or classifier widget");
  if (/cnn|분류|인식|학습|classif/i.test(prompt) && !cameras.some((w) => w.type === "classifier"))
    throw new Error(
      "The user requested CNN classification, not only a camera preview; use image_classifier",
    );
  for (const widget of cameras) {
    if (
      widget.action.source.type !== source.type ||
      (source.type === "esp32_stream" && widget.action.source.url !== source.url)
    )
      throw new Error(
        "Use the configured/requested ESP32 source URL exactly; do not invent a camera address",
      );
  }
  return widgets;
}

// LLM의 JSON을 실행 가능한 위젯 설정으로 정규화하고 허용된 스킬만 통과시킵니다.
function normalizeWidgets(items, motorRequest = false, cameraSource = null) {
  const profile = SKILL_CATALOG.profiles[state.deviceProfile] || SKILL_CATALOG.profiles.legacy;
  const allowedTypes = new Set([
    "metric",
    "gauge",
    "chart",
    "alert",
    "control",
    "button",
    "classifier",
    "camera_stream",
  ]);
  if (!Array.isArray(items) || items.length < 1 || items.length > 8)
    throw new Error("widgets must contain 1–8 widgets");
  const ids = new Set();
  // 1차 검사: 위젯 종류·ID·인자를 검증하고 명령 형식을 코드에서 결정합니다.
  const widgets = items.map((item, index) => {
    if (!item || !allowedTypes.has(item.type))
      throw new Error(`widgets[${index}]: unsupported widget type`);
    if (
      typeof item.id !== "string" ||
      !/^[a-zA-Z0-9_-]+$/.test(item.id) ||
      ids.has(item.id.toLowerCase())
    )
      throw new Error(`widgets[${index}]: unique English id required`);
    ids.add(item.id.toLowerCase());
    if (["classifier", "camera_stream"].includes(item.type)) {
      const source = item.action?.source;
      if (cameraSource && source && source.type !== cameraSource.type)
        throw new Error(`The requested camera source is ${cameraSource.type}; preserve that input`);
      const action = {
        ...item.action,
        ...(!source && cameraSource ? { source: cameraSource } : {}),
      };
      if (cameraSource && action.source?.type === "esp32_stream" && !action.source.url)
        action.source = cameraSource;
      return item.type === "classifier"
        ? normalizeVisionWidget({ ...item, action }, profile)
        : normalizeCameraWidget({ ...item, action });
    }
    const widget = {
      id: item.id,
      type: item.type,
      title: String(item.title || "센서 데이터"),
      icon: String(item.icon || "◇"),
      value: Number(item.value) || 0,
      unit: String(item.unit || ""),
      min: Number.isFinite(item.min) ? item.min : 0,
      max: Number.isFinite(item.max) ? item.max : 100,
      threshold: Number(item.threshold) || 10,
      wide: Boolean(item.wide),
      points: Array.isArray(item.points)
        ? item.points.filter(Number.isFinite).slice(0, 20)
        : undefined,
    };
    if (item.type === "button") {
      // Qwen may wrap the same allowed skills in action.skills or a single action.
      const actions =
        item.actions ?? item.action?.skills ?? (item.action?.skill ? [item.action] : undefined);
      if (!Array.isArray(actions) || !actions.length || actions.length > 8)
        throw new Error(`${item.id}: button requires 1–8 actions`);
      widget.actions = actions.map((action) => {
        if (action?.skill === "set_motor" || action?.skill === "drive_motor") {
          const skill = action.skill;
          const direction = action.direction;
          if (
            skill === "drive_motor" &&
            !["forward", "backward", "left", "right", "stop"].includes(direction)
          )
            throw new Error(
              `${item.id}: drive_motor requires forward/backward/left/right/stop direction`,
            );
          const extra = skill === "drive_motor" ? { direction } : {};
          if (direction === "stop") return { skill, direction, speed: 0, text: "CMD:motor:stop:0" };
          if (action.speedFrom !== undefined) {
            if (typeof action.speedFrom !== "string" || !action.speedFrom)
              throw new Error(`${item.id}: speedFrom must name a motor slider`);
            return { skill, ...extra, speedFrom: action.speedFrom };
          }
          if (!Number.isInteger(action.speed) || action.speed < 0 || action.speed > 80)
            throw new Error(`${item.id}: set_motor button requires integer speed 0..80 (stop = 0)`);
          return {
            skill,
            ...extra,
            speed: action.speed,
            text:
              skill === "drive_motor"
                ? `CMD:motor:${direction}:${action.speed}`
                : `CMD:motor:${action.speed}`,
          };
        }
        if (motorRequest && action?.skill === "send_text") {
          const match =
            typeof action.text === "string" && action.text.match(/^CMD:motor:(0|[1-9][0-9]?)$/);
          if (!match || Number(match[1]) > 80)
            throw new Error(
              `${item.id}: motor buttons must use set_motor with speed 0..80; stop speed is 0. Do not send arbitrary stop/action text.`,
            );
          return {
            skill: "set_motor",
            speed: Number(match[1]),
            text: `CMD:motor:${Number(match[1])}`,
          };
        }
        if (
          action?.skill !== "send_text" ||
          typeof action.text !== "string" ||
          !action.text.trim() ||
          action.text.length > 256 ||
          /[\r\n]/.test(action.text)
        )
          throw new Error(
            `${item.id}: use send_text with a nonempty single-line text of at most 256 characters`,
          );
        return { skill: "send_text", text: action.text };
      });
    } else if (item.type === "control") {
      const action = item.action;
      if (action?.skill === "set_servo" && ["servo", "valve", "mouth"].includes(action.target)) {
        widget.action = { skill: "set_servo", target: action.target };
        widget.command = `CMD:${action.target}`;
        widget.min = Math.ceil(Math.max(0, widget.min));
        widget.max = Math.floor(Math.min(180, widget.max));
      } else if (action?.skill === "set_motor") {
        widget.action = { skill: "set_motor" };
        widget.command = "CMD:motor";
        widget.min = Math.ceil(Math.max(0, widget.min));
        widget.max = Math.floor(Math.min(80, widget.max));
      } else throw new Error(`${item.id}: control requires set_servo or set_motor action`);
      if (widget.max <= widget.min) throw new Error(`${item.id}: invalid control range`);
      widget.value = Math.max(widget.min, Math.min(widget.max, Math.round(widget.value)));
    } else {
      if (
        item.action?.skill !== "display_sensor" ||
        typeof item.action.key !== "string" ||
        !/^[a-zA-Z0-9_-]+$/.test(item.action.key)
      )
        throw new Error(`${item.id}: sensor widget requires display_sensor with an English key`);
      widget.action = { skill: "display_sensor", key: item.action.key };
      widget.sensorKey = item.action.key;
    }
    const actions = widget.actions || [widget.action];
    for (const action of actions) {
      if (!profile.skills.includes(action.skill))
        throw new Error(`${item.id}: skill ${action.skill} is unavailable in this device profile`);
      if (
        action.skill === "set_servo" &&
        profile.servoTargets &&
        !profile.servoTargets.includes(action.target)
      )
        throw new Error(`${item.id}: supported servo targets: ${profile.servoTargets.join(", ")}`);
      if (
        action.skill === "send_text" &&
        profile.textCommands &&
        !profile.textCommands.includes(action.text)
      )
        throw new Error(`${item.id}: supported text commands: ${profile.textCommands.join(", ")}`);
      if (
        action.skill === "display_sensor" &&
        profile.sensorKeys &&
        !profile.sensorKeys.includes(action.key)
      )
        throw new Error(`${item.id}: supported sensor keys: ${profile.sensorKeys.join(", ")}`);
    }
    return widget;
  });
  // 2차 검사: 모든 위젯이 만들어진 뒤 버튼과 모터 슬라이더의 참조를 연결합니다.
  const motorSliders = widgets.filter(
    (w) => w.type === "control" && w.action?.skill === "set_motor",
  );
  for (const widget of widgets) {
    for (const action of widget.actions || []) {
      if (!["set_motor", "drive_motor"].includes(action.skill)) continue;
      // A stop action never reads the slider. Other direction buttons may start at 0.
      const movement = action.skill === "drive_motor" && action.direction !== "stop";
      const needsSlider = movement || action.speed > 0;
      if (!action.speedFrom && needsSlider && motorSliders.length === 1)
        action.speedFrom = motorSliders[0].id;
      if (action.speedFrom && !motorSliders.some((w) => w.id === action.speedFrom)) {
        const referenced = widgets.find((w) => w.id === action.speedFrom);
        // Qwen sometimes invents a reference ID while creating exactly one actual
        // motor slider. There is only one possible motor source in this case.
        // Never redirect an existing servo/sensor ID, or guess between two sliders.
        if (!referenced && motorSliders.length === 1) action.speedFrom = motorSliders[0].id;
        else
          throw new Error(
            `${widget.id}: speedFrom "${action.speedFrom}" must reference a set_motor control widget. Available motor slider IDs: ${motorSliders.map((w) => w.id).join(", ") || "none; add a control widget with action {skill:'set_motor'}"}`,
          );
      }
      if (!action.speedFrom && needsSlider && motorSliders.length > 1)
        throw new Error(
          `${widget.id}: specify speedFrom to select a motor slider: ${motorSliders.map((w) => w.id).join(", ")}`,
        );
    }
  }
  return widgets;
}

// Require requested steering directions; reject plans that reduce all buttons to speed.
// 사용자가 요청한 방향 버튼과 모터 속도 슬라이더의 누락을 검사합니다.
function validateDrivePlan(widgets, prompt) {
  const requests = [
    [/전진|전지(?=\s*후진)|forward/i, "forward"],
    [/후진|backward|reverse/i, "backward"],
    [/좌회전|좌우회전|왼쪽|turn left/i, "left"],
    [/우회전|좌우회전|오른쪽|turn right/i, "right"],
    [/정지|stop/i, "stop"],
  ];
  if (!/모터|motor|로봇|robot|주행|전진|후진/i.test(prompt)) return widgets;
  if (/슬라이[더드]|slider/i.test(prompt)) {
    const sliders = widgets.filter((w) => w.type === "control" && w.action?.skill === "set_motor");
    if (!sliders.length)
      throw new Error(
        "Motor speed slider requested: add a control widget with action {skill:'set_motor'} and make each movement button speedFrom its exact id",
      );
  }
  for (const [pattern, direction] of requests) {
    if (
      pattern.test(prompt) &&
      !widgets.some((w) =>
        [...(w.actions || []), ...(w.type === "classifier" ? w.action.rules : [])].some(
          (a) => a.skill === "drive_motor" && a.direction === direction,
        ),
      )
    ) {
      if (
        direction === "stop" &&
        !/전진|후진|좌회전|우회전|forward|backward|turn left|turn right/i.test(prompt)
      )
        continue;
      throw new Error(
        `Requested ${direction} needs a drive_motor button with direction '${direction}', not set_motor speed only`,
      );
    }
  }
  return widgets;
}

// Resolve values when clicked, so separate buttons use the latest slider state.
// 클릭 시점의 슬라이더 값을 읽어 버튼 명령을 만듭니다. 정지는 항상 속도 0입니다.
function resolveButtonCommands(actions, widgets) {
  return actions.map((action) => {
    if (!["set_motor", "drive_motor"].includes(action.skill)) return action.text;
    if (action.skill === "drive_motor" && action.direction === "stop") return "CMD:motor:stop:0";
    const source = action.speedFrom
      ? widgets.find(
          (w) =>
            w.id === action.speedFrom && w.type === "control" && w.action?.skill === "set_motor",
        )
      : null;
    if (action.speedFrom && !source) throw new Error("Motor speed slider is missing");
    const speed = source ? Number(source.value) : action.speed;
    if (!Number.isInteger(speed) || speed < 0 || speed > 80)
      throw new Error("Motor speed must be an integer 0..80");
    return action.skill === "drive_motor"
      ? `CMD:motor:${action.direction}:${speed}`
      : `CMD:motor:${speed}`;
  });
}

// 허용 스킬과 예시를 Qwen에 전달하고, 검증 실패 시 한 번 수정 요청을 보냅니다.
async function generateWithQwen(prompt) {
  if (!state.qwenModelId && !(await checkQwenConnection()))
    throw new Error("Qwen3 8B에 연결할 수 없습니다.");
  const profile = SKILL_CATALOG.profiles[state.deviceProfile] || SKILL_CATALOG.profiles.legacy;
  const availableSkills = {
    ...Object.fromEntries(profile.skills.map((id) => [id, HARNESS_SKILLS[id]])),
    ...Object.fromEntries(
      Object.entries(SKILL_CATALOG.browserSkills).filter(([, skill]) => !skill.internal),
    ),
  };
  const cameraSource = requestedCameraSource(prompt);
  // 이 프롬프트는 실행 코드가 아닌 JSON 설정만 생성하도록 모델을 제한합니다.
  const system = `Device profile: ${JSON.stringify(profile)}. Only use its listed skills, servoTargets, sensorKeys and textCommands when present. Send literal command text.
You are PHYVIBE's network webapp planner. Return JSON only; do not generate executable code. Use only the supplied skills and their arguments: ${JSON.stringify(availableSkills)}.
Button example (copy this structure for literal text requests): {"title":"Send a","widgets":[{"id":"send-a","type":"button","title":"Send a","actions":[{"skill":"send_text","text":"a"}]}]}.
Motor speed slider: type "control", action {"skill":"set_motor"}, integer min 0/max 80/value 50. Direction buttons: type "button", actions [{"skill":"drive_motor","direction":"forward|backward|left|right","speedFrom":"EXACT_SLIDER_ID"}]. speedFrom is the actual slider widget id (case-sensitive), never the skill name, title or variable name. Always include the referenced control widget in the same widgets array. For direction buttons without a slider, use fixed speed 0..80 instead. Stop is always {"skill":"drive_motor","direction":"stop","speed":0} with no speedFrom. Use "set_motor" buttons only for plain speed control, not directional movement. Never invent stop/action/start text commands. Direction buttons form a cross automatically. Korean 전지후진 means 전진/후진 here; 좌우회전 means both left and right.
Complete robot remote example with ONE shared speed slider (copy the structure; all speedFrom values equal the slider id): {"title":"Robot remote","widgets":[{"id":"motor-speed","type":"control","title":"Motor speed","min":0,"max":80,"value":50,"action":{"skill":"set_motor"}},{"id":"forward","type":"button","title":"전진","actions":[{"skill":"drive_motor","direction":"forward","speedFrom":"motor-speed"}]},{"id":"backward","type":"button","title":"후진","actions":[{"skill":"drive_motor","direction":"backward","speedFrom":"motor-speed"}]},{"id":"left","type":"button","title":"좌회전","actions":[{"skill":"drive_motor","direction":"left","speedFrom":"motor-speed"}]},{"id":"right","type":"button","title":"우회전","actions":[{"skill":"drive_motor","direction":"right","speedFrom":"motor-speed"}]},{"id":"stop","type":"button","title":"정지","actions":[{"skill":"drive_motor","direction":"stop","speed":0}]}]}.
For plain motor speed control, use set_motor on the slider and {"skill":"set_motor","speedFrom":"EXACT_SLIDER_ID"} on a separate run button. A plain speed stop button uses {"skill":"set_motor","speed":0}. Runtime generates CMD:motor:<speed> or CMD:motor:<direction>:<speed>, always using the current slider value on click.
Sensor example: {"title":"Temperature","widgets":[{"id":"temperature","type":"metric","title":"Temperature","action":{"skill":"display_sensor","key":"temperature"},"value":0,"unit":"°C"}]}.
${profile.skills.includes("set_servo") ? 'Control example: {"title":"Servo","widgets":[{"id":"servo","type":"control","title":"Servo","action":{"skill":"set_servo","target":"servo"},"min":0,"max":180,"value":90}]} .' : "This profile does not support control widgets."}
ESP32 camera access is direct from this browser; NEVER create a PC video relay or send frames through the motor bridge. Configured camera source: ${JSON.stringify(cameraSource || (state.cameraUrl ? { type: "esp32_stream", url: state.cameraUrl } : { type: "webcam" }))}. Preserve the requested URL; do not invent an IP. For ESP32 CNN/classification use type classifier with action image_classifier and source:{type:"esp32_stream",url:"..."}. For video display only use type camera_stream, action:{skill:"camera_stream",source:{type:"esp32_stream",url:"..."}}. If the URL is unknown use an empty string; the user enters it in the widget. A CNN widget includes sample collection, MobileNet feature extraction, local head training, single or continuous classification. Merely displaying video does not classify it.
Camera apps use a classifier widget; browser skills are available on every profile, but every rule/game text must obey the device profile's send_text restrictions. Do not generate custom JavaScript or claim text Qwen sees images. The browser handles CNN training and inference.
Classifier example: {"title":"Image classifier","widgets":[{"id":"camera","type":"classifier","title":"My classifier","action":{"skill":"image_classifier","classes":["open","closed"],"confidence":0.8,"rules":[]}}]}.
Rock-paper-scissors example (use for Korean 가위바위보 or English rock paper scissors requests): {"title":"가위바위보","widgets":[{"id":"hand-game","type":"classifier","title":"카메라 가위바위보","action":{"skill":"image_classifier","classes":["rock","paper","scissors"],"confidence":0.8,"game":{"beats":[["rock","scissors"],["scissors","paper"],["paper","rock"]],"winText":"O","lossText":"x","drawText":""}}}]}.
Use classes requested by the user, and define beats with EXACT matching labels. Only include output texts the user requests; no transmission for empty texts. Uppercase O and lowercase x must be preserved. For a generic classifier, use custom classes and optional label rules. Rules may use send_text with exact text, set_motor with integer speed 0..80, drive_motor with direction plus speed 0..80, or set_servo with target and integer angle 0..180. Rules use fixed validated values, never speedFrom. Example: {label:"defect",skill:"drive_motor",direction:"stop",speed:0}. Device rules do not require extra manual buttons. Only MobileNet CNN image classification is implemented; do not claim ViT, YOLO, OCR, detection boxes or segmentation. Camera-only/CNN-only applications run without the motor bridge. Trained classifiers can be included in standalone HTML by Studio export. For unsupported operations, explain failure rather than substitute unrelated sensor widgets.
Optional widget fields: icon, value, unit, min, max, threshold, wide, points.
Create 1–8 widgets. metric/gauge/chart/alert must have action display_sensor. control must have action set_servo with target or set_motor. button must have actions:[{"skill":"send_text","text":"a"}] for literal text or actions:[{"skill":"set_motor","speed":50}] for motor speed or actions:[{"skill":"drive_motor","direction":"forward","speed":50}] for directional movement instead of action; actions execute in order. For a request to send literal 'a' on click, make a button whose send_text text is exactly "a". Never add CMD prefixes, numeric values, or newlines to literal text. Keep explicit user sensor keys and payloads exactly. Do not substitute a slider for a requested button.
The browser communicates with an HTTP bridge over Wi-Fi/Ethernet. ESP32 bridges Wi-Fi; micro:bit handles physical control and is programmed separately in MakeCode. No serial/USB or provisioning. /no_think`;
  const messages = [
    { role: "system", content: system },
    { role: "user", content: prompt },
  ];
  // 최초 응답이 검증을 통과하지 못하면 오류를 첨부해 한 번만 재요청합니다.
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(`${QWEN_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: state.qwenModelId,
        stream: false,
        messages,
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) throw new Error(`Qwen 요청 실패 (HTTP ${response.status})`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    try {
      const result = extractJson(content);
      return {
        title: String(result.title || "피지컬 AI 대시보드"),
        widgets: validateCameraPlan(
          validateDrivePlan(
            normalizeWidgets(
              result.widgets,
              /모터|motor|팬|fan|전진|후진|주행/i.test(prompt),
              cameraSource,
            ),
            prompt,
          ),
          prompt,
          cameraSource,
        ),
      };
    } catch (error) {
      if (attempt === 1) throw new Error(`생성 하네스 검증 실패: ${error.message}`);
      messages.push(
        { role: "assistant", content },
        {
          role: "user",
          content: `Your plan failed validation: ${error.message}. Correct the JSON using only the supported skills. Preserve the original user's literal payloads and sensor keys. Return the entire corrected plan.`,
        },
      );
    }
  }
}

// 사용자·모델 문자열을 HTML에 넣기 전에 특수문자를 이스케이프합니다.
function escapeHtml(value) {
  return String(value).replace(
    /[&<>'"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c],
  );
}

// 위젯 하나의 HTML을 만듭니다. 영상 위젯은 공통 비전 렌더러에 위임합니다.
function renderWidget(widget) {
  if (["classifier", "camera_stream"].includes(widget.type)) return renderVisionWidget(widget);
  const wide = widget.wide ? " wide" : "";
  const warning =
    widget.type === "alert" && Number(widget.value) <= Number(widget.threshold) ? " warning" : "";
  const head = `<div class="widget-head"><span>${escapeHtml(widget.title)}</span><span class="widget-icon">${escapeHtml(widget.icon || "◇")}</span></div>`;
  if (widget.type === "button") {
    const commands = escapeHtml(JSON.stringify(widget.actions.map((action) => action.text)));
    const direction = widget.actions.find((action) => action.skill === "drive_motor")?.direction;
    const positions = {
      forward: "1 / 2",
      left: "2 / 1",
      stop: "2 / 2",
      right: "2 / 3",
      backward: "3 / 2",
    };
    const drive = positions[direction]
      ? ` drive-button" style="grid-area:${positions[direction]};min-width:0`
      : "";
    return `<article class="widget${wide}${drive}" data-widget="${widget.id}">${head}<button class="widget-action primary" data-actions="${escapeHtml(JSON.stringify(widget.actions))}" data-commands="${commands}">${escapeHtml(widget.title)}</button></article>`;
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
    const status = Number(widget.value) < Number(widget.threshold || -Infinity) ? "주의" : "정상";
    return `<article class="widget${wide}${status === "주의" ? " warning" : ""}" data-widget="${widget.id}">${head}<div class="gauge" style="--gauge-value:${ratio}%"></div><div class="widget-main"><span class="widget-value">${escapeHtml(widget.value)}</span><span class="widget-unit">${escapeHtml(widget.unit)}</span><span class="trend">${status}</span></div></article>`;
  }
  if (widget.type === "control") {
    const command =
      widget.command === "MOT"
        ? `MOT:${escapeHtml(widget.value)}:${escapeHtml(widget.value)}`
        : `${widget.command || `CMD:${widget.id}`}:${escapeHtml(widget.value)}`;
    const stop = widget.command === "MOT" ? "MOT:0:0" : `${widget.command || `CMD:${widget.id}`}:0`;
    return `<article class="widget${wide}" data-widget="${widget.id}">${head}<div class="widget-main"><span class="widget-value" data-control-value>${escapeHtml(widget.value)}</span><span class="widget-unit">${escapeHtml(widget.unit)}</span></div><div class="slider-row"><span>${widget.min}</span><input type="range" min="${widget.min}" max="${widget.max}" value="${escapeHtml(widget.value)}" data-control="${widget.id}"><span>${widget.max}</span></div><div class="action-row"><button class="widget-action" data-control-action="stop" data-command="${stop}">정지</button><button class="widget-action primary" data-control-action="apply" data-command="${command}">적용</button></div></article>`;
  }
  return `<article class="widget${wide}${warning}" data-widget="${widget.id}">${head}<div class="widget-main"><span class="widget-value">${escapeHtml(widget.value)}</span><span class="widget-unit">${escapeHtml(widget.unit)}</span>${widget.trend ? `<span class="trend">${escapeHtml(widget.trend)}</span>` : ""}</div><div class="meter"><i style="width:${Math.min(100, Math.max(3, ((widget.value - (widget.min || 0)) / ((widget.max || 100) - (widget.min || 0))) * 100))}%"></i></div>${widget.type === "alert" ? `<div class="action-row"><span class="widget-action">기준 ${widget.threshold}${escapeHtml(widget.unit)}</span></div>` : ""}</article>`;
}

// 라이브 위젯과 함께 스키마 및 실행 코드 미리보기도 갱신합니다.
function renderWidgets() {
  $(".dashboard-head").classList.toggle("hidden", state.widgets.length === 0);
  studioVision.render($("#widgetGrid"), state.widgets);
  $("#schemaContent").textContent = JSON.stringify(
    {
      version: 3,
      skills: HARNESS_SKILLS,
      deviceProfile: state.deviceProfile,
      network: {
        transport: "http",
        bridgeUrl: state.bridgeUrl,
        statusPath: "/api/status",
        commandPath: "/api/command",
      },
      title: $("#dashboardTitle").textContent,
      widgets: state.widgets,
    },
    null,
    2,
  );
  const project = {
    title: $("#dashboardTitle").textContent,
    network: { transport: "http", bridgeUrl: state.bridgeUrl, deviceProfile: state.deviceProfile },
    widgets: state.widgets,
  };
  $("#codeContent").textContent =
    `${visionStyles.toString()}\n${visionDecision.toString()}\n${renderVisionWidget.toString()}\n${normalizeVisionSource.toString()}\n${createEsp32FrameSource.toString()}\n${createVisionRuntime.toString()}\n${deliverCommand.toString()}\n${escapeHtml.toString()}\n${resolveButtonCommands.toString()}\n${renderWidget.toString()}\n(${userAppRuntime.toString()})(${JSON.stringify(project, null, 2)});`;
}

// 최근 네트워크 로그를 제한된 개수로 유지하며 모니터에 표시합니다.
function addLog(direction, message, level = "") {
  const time = new Date().toLocaleTimeString("ko-KR", { hour12: false });
  state.logs.push({ time, direction, message, level });
  state.logs = state.logs.slice(-80);
  $("#terminal").innerHTML = state.logs
    .map(
      (log) =>
        `<div class="log-row"><span class="time">${log.time}</span><span class="${log.level || log.direction.toLowerCase()}">${log.direction}</span><span>${escapeHtml(log.message)}</span></div>`,
    )
    .join("");
  $("#terminal").scrollTop = $("#terminal").scrollHeight;
}

// 짧은 안내를 표시하고 기존 숨김 타이머를 교체합니다.
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2200);
}

// 생성 대화 영역에 사용자 요청 또는 AI 응답을 추가합니다.
function appendMessage(role, text, typing = false) {
  const article = document.createElement("article");
  article.className = `message ${role === "user" ? "user-message" : "ai-message build-message"}`;
  article.innerHTML =
    role === "user"
      ? `<div><p>${escapeHtml(text)}</p></div>`
      : `<div class="bot-icon">✦</div><div class="${typing ? "typing" : ""}"><strong>PHYVIBE AI</strong><p>${escapeHtml(text)}</p></div>`;
  $("#conversation").append(article);
  $("#conversation").scrollTop = $("#conversation").scrollHeight;
  return article;
}

// 데모 모드의 로컬 규칙입니다. 이 경로는 LLM에 요청하지 않습니다.
function widgetsFromPrompt(prompt) {
  const p = prompt.toLowerCase();
  const widgets = [];
  const source = requestedCameraSource(prompt);
  if (source) {
    if (/분류|인식|cnn|classif/i.test(prompt))
      return [
        normalizeVisionWidget(
          {
            id: "esp32-classifier",
            type: "classifier",
            action: {
              skill: "image_classifier",
              source,
              classes: ["class-a", "class-b"],
              rules: [],
            },
          },
          SKILL_CATALOG.profiles[state.deviceProfile],
        ),
      ];
    return [
      normalizeCameraWidget({
        id: "esp32-camera",
        type: "camera_stream",
        action: { skill: "camera_stream", source },
      }),
    ];
  }
  if (/가위\s*바위\s*보|rock[\s,-]*(?:paper|scissor)|rock.*scissor/i.test(prompt))
    return [
      normalizeVisionWidget(
        {
          id: "hand-game",
          type: "classifier",
          title: "카메라 가위바위보",
          action: {
            skill: "image_classifier",
            classes: ["rock", "paper", "scissors"],
            confidence: 0.8,
            game: {
              beats: [
                ["rock", "scissors"],
                ["scissors", "paper"],
                ["paper", "rock"],
              ],
              winText: "O",
              lossText: "x",
              drawText: "",
            },
          },
        },
        SKILL_CATALOG.profiles[state.deviceProfile],
      ),
    ];
  if (/화분|토양|soil|급수/.test(p)) {
    widgets.push({
      id: "soil",
      type: "gauge",
      title: "토양 수분",
      icon: "🌱",
      value: 24,
      unit: "%",
      min: 0,
      max: 100,
      threshold: 30,
      pin: "P1",
    });
    widgets.push({
      id: "valve",
      type: "control",
      title: "급수 밸브",
      icon: "💧",
      value: 0,
      unit: "°",
      min: 0,
      max: 180,
      pin: "P0",
      command: "CMD:valve",
    });
  }
  if (/터틀|자율주행|좌우 모터/.test(p)) {
    widgets.push({
      id: "sonar",
      type: "alert",
      title: "전방 거리",
      icon: "◉",
      value: 42,
      unit: "cm",
      threshold: 15,
      min: 0,
      max: 100,
      pin: "P2",
    });
    widgets.push({
      id: "motor",
      type: "control",
      title: "주행 속도",
      icon: "🐢",
      value: 50,
      unit: "%",
      min: 0,
      max: 80,
      action: { skill: "set_motor" },
      command: "CMD:motor",
    });
  }
  if (/온도|온습도|temperature/.test(p))
    widgets.push({
      id: "temperature",
      type: "metric",
      title: "실내 온도",
      icon: "🌡",
      value: 24.6,
      unit: "°C",
      min: 0,
      max: 40,
      trend: "+0.4°C",
      pin: "P0",
    });
  if (/습도|온습도|humidity/.test(p))
    widgets.push({
      id: "humidity",
      type: "gauge",
      title: "상대 습도",
      icon: "◌",
      value: 58,
      unit: "%",
      min: 0,
      max: 100,
      pin: "P1",
    });
  if (/거리|초음파|접근/.test(p))
    widgets.push({
      id: "distance",
      type: "alert",
      title: "접근 감지",
      icon: "◉",
      value: 34,
      unit: "cm",
      threshold: 10,
      min: 0,
      max: 100,
      pin: "P2",
    });
  if (/모터|팬|motor/.test(p) && !widgets.some((widget) => widget.id === "motor"))
    widgets.push({
      id: "motor",
      type: "control",
      title: "DC 모터 속도",
      icon: "⚙",
      value: 50,
      unit: "%",
      min: 0,
      max: 80,
      pin: "micro:bit",
      action: { skill: "set_motor" },
      command: "CMD:motor",
    });
  if (/서보|servo/.test(p))
    widgets.push({
      id: "servo",
      type: "control",
      title: "서보 각도",
      icon: "↻",
      value: 90,
      unit: "°",
      min: 0,
      max: 180,
      pin: "P0",
    });
  if (/조도|빛|light/.test(p))
    widgets.push({
      id: "light",
      type: "metric",
      title: "주변 조도",
      icon: "☀",
      value: 72,
      unit: "%",
      min: 0,
      max: 100,
      pin: "P1",
    });
  if (/차트|그래프|변화|모니터/.test(p))
    widgets.push({
      id: "chart",
      type: "chart",
      title: "센서 변화",
      icon: "⌁",
      value: 24.6,
      unit: "",
      wide: true,
      points: [20, 24, 22, 29, 26, 33, 31, 38],
    });
  return widgets.length
    ? widgets
    : [
        {
          id: "sensor",
          type: "metric",
          title: "센서 데이터",
          icon: "◇",
          value: 42,
          unit: "",
          min: 0,
          max: 100,
          pin: "P0",
        },
      ];
}

// 생성 버튼의 전체 흐름을 처리하고 성공한 계획만 내보내기 가능 상태로 만듭니다.
async function generate() {
  const input = $("#promptInput");
  const prompt = input.value.trim();
  if (!prompt || state.generating) return;
  state.generating = true;
  $("#deviceProfileSelect").disabled = true;
  state.generationValid = false;
  $("#exportBtn").disabled = true;
  $("#generateBtn").disabled = true;
  appendMessage("user", prompt);
  input.value = "";
  const typing = appendMessage("ai", "요청을 분석하고 하드웨어 안전 규칙을 적용하는 중…", true);
  if (state.target === "widget") {
    try {
      if (!["qwen", "demo"].includes(state.provider))
        throw new Error(
          "이 공급자의 웹앱 생성은 아직 지원되지 않습니다. AI 설정에서 Local Qwen을 선택하세요.",
        );
      const generated =
        state.provider === "qwen"
          ? await generateWithQwen(prompt)
          : {
              title: /화분|토양/.test(prompt)
                ? "잔소리 식물 화분"
                : /터틀|자율주행/.test(prompt)
                  ? "자율주행 터틀 컨트롤"
                  : prompt.length > 20
                    ? "새 피지컬 AI 대시보드"
                    : prompt.replace(/만들어줘|보여줘|해줘/g, "").trim(),
              widgets: widgetsFromPrompt(prompt),
            };
      state.widgets = generated.widgets;
      state.generationValid = true;
      $("#exportBtn").disabled = false;
      $("#dashboardTitle").textContent = generated.title;
      renderWidgets();
      typing.querySelector("div:last-child").classList.remove("typing");
      typing.querySelector("p").textContent =
        `${state.provider === "qwen" ? "로컬 Qwen이 " : "데모 규칙 엔진이 (LLM 요청 없음) "}${state.widgets.length}개의 위젯을 생성했어요. 지원 스킬과 네트워크 동작을 적용했습니다.`;
    } catch (error) {
      typing.querySelector("div:last-child").classList.remove("typing");
      typing.querySelector("p").textContent = `생성 실패: ${error.message}`;
      state.generating = false;
      $("#deviceProfileSelect").disabled = false;
      $("#generateBtn").disabled = false;
      if (state.provider === "qwen" && !state.qwenModelId) startQwenGate();
      return;
    }
  }
  state.generating = false;
  $("#deviceProfileSelect").disabled = false;
  $("#generateBtn").disabled = false;
  toast("안전 규칙을 적용해 생성했습니다");
}

// 라이브 화면, 실행 코드, JSON 스키마 탭을 전환합니다.
function switchView(view) {
  $$("#viewTabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $("#previewFrame").classList.toggle("hidden", view !== "preview");
  $("#codeView").classList.toggle("hidden", view !== "code");
  $("#schemaView").classList.toggle("hidden", view !== "schema");
}

// 오른쪽 브릿지 연결 상태의 아이콘과 설명을 갱신합니다.
function setConnection(mode, label, sub) {
  const icon = $("#connectionIcon");
  icon.className = `connection-icon ${mode}`;
  icon.textContent = mode === "online" ? "●" : mode === "error" ? "!" : "⌁";
  $("#connectionLabel").textContent = label;
  $("#connectionSub").textContent = sub;
}

// 수신 센서 데이터를 해당 위젯에 반영합니다. 카메라 영상은 이 경로를 쓰지 않습니다.
function handlePacket(raw) {
  addLog("RX", raw);
  const line = raw.trim();
  const dataMatch = line.match(/^DATA:([^:]+):(.+)$/i);
  if (dataMatch) {
    const [, key, rawValue] = dataMatch;
    const numeric = Number(rawValue);
    const value = Number.isFinite(numeric) ? numeric : rawValue;
    const widget = state.widgets.find(
      (w) =>
        !["classifier", "camera_stream"].includes(w.type) &&
        (w.sensorKey || w.id).toLowerCase() === key.toLowerCase(),
    );
    if (widget) {
      widget.value = value;
      if (widget.points) widget.points = [...widget.points.slice(-11), Number(value) || 0];
      renderWidgets();
    }
    $("#lastUpdated").textContent = "방금 전";
    return;
  }
  try {
    const packet = JSON.parse(raw);
    if (packet.type === "sensor") {
      const widget = state.widgets.find(
        (w) =>
          !["classifier", "camera_stream"].includes(w.type) && (w.sensorKey || w.id) === packet.k,
      );
      if (widget) {
        widget.value = packet.val;
        renderWidgets();
      }
      $("#lastUpdated").textContent = "방금 전";
    }
  } catch {
    /* Keep unstructured network data visible in the monitor. */
  }
}

// 브릿지 상태 조회를 시작하거나 중지합니다. 이전 조회는 먼저 취소합니다.
function toggleBridge(enabled) {
  state.pollController?.abort();
  state.pollController = null;
  state.bridge = null;
  $("#gatewayValue").textContent = "—";
  $("#clientCountValue").textContent = "—";
  $("#rttValue").textContent = "—";
  if (!enabled) {
    setConnection("", "네트워크 대기 중", "연결이 중지되었습니다");
    return;
  }
  try {
    const url = new URL($("#bridgeUrlInput").value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new Error("HTTP 또는 HTTPS 서버 URL을 입력하세요");
    state.bridgeUrl = url.href.replace(/\/$/, "");
    localStorage.setItem("phyvibe.bridgeUrl", state.bridgeUrl);
  } catch (error) {
    $("#bridgeToggle").checked = false;
    setConnection("error", "URL 확인", error.message);
    return;
  }
  state.lastMessageId = 0;
  const controller = new AbortController();
  state.pollController = controller;
  renderWidgets();
  setConnection("", "네트워크 연결 중", state.bridgeUrl);
  addLog("SYS", `HTTP bridge: ${state.bridgeUrl}`);
  async function poll() {
    if (controller.signal.aborted) return;
    try {
      const started = performance.now();
      const response = await fetch(`${state.bridgeUrl}/api/status`, {
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const status = await response.json();
      if (controller.signal.aborted) return;
      state.bridge = true;
      setConnection(
        "online",
        "서버 연결 완료",
        `${state.bridgeUrl} · 수신 ${status.message_sequence || 0}건 · ESP32 명령 연결 ${status.connected_clients}대`,
      );
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

// 에디터에서 명령을 전송합니다. 일반 제어값은 제한하고 명시적 문자열은 보존합니다.
async function sendNetwork(text, literal = false) {
  let value = text;
  if (typeof value !== "string" || !value.trim()) return false;
  const servo = value.match(/^CMD:(servo|valve|mouth):(-?\d+(?:\.\d+)?)$/i);
  if (servo && !literal) {
    const safeAngle = Math.min(180, Math.max(0, Number(servo[2])));
    if (safeAngle !== Number(servo[2]))
      addLog("SAFE", `서보 각도 ${servo[2]}° → ${safeAngle}° 클램핑`);
    value = `CMD:${servo[1]}:${safeAngle}`;
  }
  const motor = value.match(/^MOT:(-?\d+):(-?\d+)$/i);
  if (motor && !literal) {
    const left = Math.min(255, Math.max(-255, Number(motor[1]))),
      right = Math.min(255, Math.max(-255, Number(motor[2])));
    value = `MOT:${left}:${right}`;
    if (left !== Number(motor[1]) || right !== Number(motor[2]))
      addLog("SAFE", `모터 PWM을 -255~255로 제한: ${value}`);
  }
  if (!state.bridge) {
    toast("네트워크 서버를 먼저 연결하세요");
    return false;
  }
  try {
    return await deliverCommand(
      { bridgeUrl: state.bridgeUrl },
      value,
      (message) => addLog("TX", message),
      state.pollController?.signal,
    );
  } catch (error) {
    addLog("ERR", `명령 전송 실패: ${error.message}`, "err");
    toast("네트워크 명령 전송 실패");
    return false;
  }
}

// 독립 HTML에 포함되는 실행 함수입니다. Studio의 state나 DOM 도우미에 의존하지 않습니다.
function userAppRuntime(project) {
  const grid = document.querySelector("#widgetGrid");
  const status = document.querySelector("#status");
  const monitor = document.querySelector("#monitor");
  const endpoint = document.querySelector("#endpoint");
  endpoint.value = project.network.bridgeUrl;
  let controller,
    lastId = 0;
  function log(text) {
    monitor.textContent = (monitor.textContent + text + "\n").split("\n").slice(-80).join("\n");
  }
  const vision = createVisionRuntime(send, project.visionModels || {});
  if (typeof window !== "undefined")
    window.addEventListener("pagehide", () => vision.dispose(), { once: true });
  function render() {
    vision.render(grid, project.widgets);
  }
  async function send(command, literal = false) {
    if (!controller || controller.signal.aborted) {
      status.textContent = "서버를 먼저 연결하세요";
      return;
    }
    try {
      const servo = command.match(/^CMD:(servo|valve|mouth):(-?\d+(?:\.\d+)?)$/i);
      if (servo && !literal)
        command = `CMD:${servo[1]}:${Math.max(0, Math.min(180, Number(servo[2])))}`;
      const motor = command.match(/^MOT:(-?\d+):(-?\d+)$/i);
      if (motor && !literal)
        command = `MOT:${Math.max(-255, Math.min(255, Number(motor[1])))}:${Math.max(-255, Math.min(255, Number(motor[2])))}`;
      return await deliverCommand(project.network, command, log, controller.signal);
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
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
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
        const response = await fetch(`${project.network.bridgeUrl}/api/status`, {
          cache: "no-store",
          signal: AbortSignal.any([current.signal, AbortSignal.timeout(5000)]),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (current.signal.aborted) return;
        status.textContent = `서버 연결 완료 · 수신 ${data.message_sequence || 0}건 · ESP32 명령 연결 ${data.connected_clients}대`;
        if (data.message_sequence < lastId) lastId = 0;
        for (const item of [...(data.message_history || [])].reverse()) {
          if (item.id <= lastId) continue;
          for (const line of String(item.message).split(/\r?\n/).filter(Boolean)) {
            log(`RX ${line}`);
            const match = line.match(/^DATA:([^:]+):(.+)$/i);
            let key, value;
            if (match) {
              key = match[1];
              value = Number.isFinite(Number(match[2])) ? Number(match[2]) : match[2];
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
                !["classifier", "camera_stream"].includes(w.type) &&
                (w.sensorKey || w.id).toLowerCase() === String(key).toLowerCase(),
            );
            if (widget) {
              widget.value = value;
              if (widget.points && Number.isFinite(Number(value)))
                widget.points = [...widget.points.slice(-11), Number(value)];
            } else if (key !== undefined)
              log(
                `INFO 센서 키 "${key}"와 일치하는 위젯 없음. 사용 가능한 키: ${project.widgets.map((w) => w.id).join(", ")}`,
              );
            else log("INFO 위젯 업데이트 형식: DATA:<센서키>:<값> 또는 sensor JSON");
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
  // 슬라이더는 상태만 갱신하고, 실제 명령은 적용·동작 버튼을 누를 때 보냅니다.
  grid.addEventListener("input", (e) => {
    if (!e.target.matches("[data-control]")) return;
    const widget = project.widgets.find((w) => w.id === e.target.dataset.control);
    widget.value = Math.max(widget.min, Math.min(widget.max, Math.round(Number(e.target.value))));
    e.target.closest(".widget").querySelector("[data-control-value]").textContent = widget.value;
  });
  // 독립 웹앱에서도 버튼을 누른 시점의 상태로 명령을 계산합니다.
  grid.addEventListener("click", (e) => {
    if (e.target.dataset.commands) {
      (async () => {
        for (const command of e.target.dataset.actions
          ? resolveButtonCommands(JSON.parse(e.target.dataset.actions), project.widgets)
          : JSON.parse(e.target.dataset.commands)) {
          if (!(await send(command, true))) break;
        }
      })();
      return;
    }
    let command = e.target.dataset.command;
    if (!command) return;
    const current = e.target.closest(".widget")?.querySelector("[data-control-value]")?.textContent;
    if (current && e.target.dataset.controlAction !== "stop")
      command = command.startsWith("MOT:")
        ? `MOT:${current}:${current}`
        : command.replace(/:-?\d+(?:\.\d+)?$/, `:${current}`);
    send(command);
  });
  render();
}

// 현재 계획과 공통 실행 함수를 HTML 하나로 묶습니다. 필요한 함수는 toString()으로 포함합니다.
async function downloadProject() {
  if (!state.generationValid || state.generating) {
    toast("먼저 웹앱을 성공적으로 생성하세요. 이전 결과는 새 웹앱으로 내보낼 수 없습니다.");
    return;
  }
  const widgets = state.widgets;
  let visionModels;
  try {
    visionModels = await studioVision.exportModels();
  } catch (error) {
    toast(error.message);
    return;
  }
  if (widgets !== state.widgets || !state.generationValid || state.generating) {
    toast("생성 결과가 변경되었습니다. 다시 내보내세요.");
    return;
  }
  const project = {
    version: 3,
    visionModels,
    harnessVersion: "3.2",
    name: $("#projectName").value,
    title: $("#dashboardTitle").textContent,
    network: { transport: "http", bridgeUrl: state.bridgeUrl, deviceProfile: state.deviceProfile },
    widgets: state.widgets,
  };
  // 영상·분류만 있는 앱은 하드웨어 브릿지 연결 UI가 필요하지 않습니다.
  const needsBridge = project.widgets.some(
    (widget) =>
      !["classifier", "camera_stream"].includes(widget.type) ||
      (widget.type === "classifier" &&
        (widget.action.rules.some((rule) => rule.text) ||
          Object.entries(widget.action.game || {}).some(
            ([key, value]) => key.endsWith("Text") && value,
          ))),
  );
  const json = JSON.stringify(project, null, 2).replace(/</g, "\\u003c");
  // 아래 함수 목록은 생성 웹앱의 의존성입니다. 새 실행 도우미도 여기에 포함해야 합니다.
  const script = `// Command delivery\n${deliverCommand.toString()}\n\n// Display helpers\n${escapeHtml.toString()}\n\n${resolveButtonCommands.toString()}\n${renderWidget.toString()}\n\n// Browser camera, transfer learning, and rules\n${visionStyles.toString()}\n\n${visionDecision.toString()}\n\n${renderVisionWidget.toString()}\n\n${normalizeVisionSource.toString()}\n${createEsp32FrameSource.toString()}\n${createVisionRuntime.toString()}\n\n// Network connection, sensor updates, and button actions\n${userAppRuntime.toString()}\n\n// Generated dashboard configuration\nconst dashboardProject = ${json};\n\n// Start the dashboard\nuserAppRuntime(dashboardProject);`;
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

.widget-grid:has(> .drive-button){grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.widget-grid:has(> .drive-button)>:not(.drive-button){grid-column:1 / -1;grid-row:auto}
.drive-button{padding:10px;min-height:100px}.drive-button .widget-action{width:100%;white-space:normal}
</style>
</head>
<body>
  <h1>${escapeHtml(project.title)}</h1>
  <p>${needsBridge ? "하드웨어 제어: 서버 → ESP32 Wi-Fi 브릿지 → micro:bit" : "카메라 직접 연결 · 이미지 분류는 브라우저에서 실행"}</p>

  <!-- Network connection controls -->
  <section ${needsBridge ? "" : "hidden"}>
  <input id="endpoint" aria-label="브릿지 서버 URL">
  <button id="connect">연결</button>
  <button id="disconnect">연결 중지</button>
  <p id="status">네트워크 대기 중</p>
  </section>

  <style data-vision-style>${visionStyles()}
.widget-grid:has(> .drive-button){grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.widget-grid:has(> .drive-button)>:not(.drive-button){grid-column:1 / -1;grid-row:auto}
.drive-button{padding:10px;min-height:100px}.drive-button .widget-action{width:100%;white-space:normal}
</style>

  <!-- Widgets are rendered from dashboardProject below -->
  <main id="widgetGrid" class="widget-grid"></main>

  <!-- Received network data and outgoing commands -->
  <section ${needsBridge ? "" : "hidden"}><h2>Wi-Fi 데이터 모니터</h2>
  <pre id="monitor"></pre></section>

  <script>
${script
  .split("\n")
  .map((line) => (line ? `    ${line}` : ""))
  .join("\n")}
  <\/script>
</body>
</html>
`;
  const blob = new Blob([html], { type: "text/html" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "phyvibe-webapp.html";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("독립 실행 네트워크 웹앱을 내보냈습니다");
}

// 공급자 변경 시 설정 화면의 모델 목록과 현재 선택을 맞춥니다.
function updateModelOptions() {
  const provider = $("#providerSelect").value;
  $("#modelSelect").innerHTML = modelOptions[provider]
    .map((m) => `<option value="${m.value}">${m.label}</option>`)
    .join("");
  if (modelOptions[provider].some((m) => m.value === state.model))
    $("#modelSelect").value = state.model;
}

// 설정 화면에서 외부 공급자 API 키의 연결 상태를 확인합니다.
async function testApi() {
  const provider = $("#providerSelect").value,
    key = $("#apiKeyInput").value.trim(),
    result = $("#testResult");
  if (provider === "qwen") {
    result.className = "test-result";
    result.textContent = "연결 확인 중…";
    try {
      await configureQwenUrl($("#llmUrlInput").value);
    } catch (error) {
      result.className = "test-result error";
      result.textContent = error.message;
      return;
    }
    const connected = await checkQwenConnection();
    result.className = connected ? "test-result ok" : "test-result error";
    result.textContent = connected
      ? "연결 성공 · 로컬 Qwen3 8B가 정상 응답했습니다."
      : "연결 실패 · Qwen3 8B를 실행해 주세요.";
    return;
  }
  if (!key) {
    result.className = "test-result error";
    result.textContent = "API 키를 입력해 주세요.";
    return;
  }
  result.className = "test-result";
  result.textContent = "연결 확인 중…";
  try {
    const url =
      provider === "openai"
        ? "https://api.openai.com/v1/models"
        : `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
    const options = provider === "openai" ? { headers: { Authorization: `Bearer ${key}` } } : {};
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    result.className = "test-result ok";
    result.textContent = "연결 성공 · API가 정상 응답했습니다.";
  } catch (error) {
    result.className = "test-result error";
    result.textContent = `연결 실패 · ${error.message}`;
  }
}

// 에디터 UI 이벤트를 등록합니다. 생성, 제어, 연결, 설정, 내보내기를 묶어 관리합니다.
function bindEvents() {
  // 카메라 주소 저장과 오른쪽 미리보기 수명 관리
  $("#esp32CameraUrl").addEventListener("change", (event) => {
    try {
      state.cameraUrl = normalizeVisionSource({
        type: "esp32_stream",
        url: event.target.value,
      }).url;
      event.target.value = state.cameraUrl;
      localStorage.setItem("phyvibe.cameraUrl", state.cameraUrl);
      renderStudioCamera();
    } catch (error) {
      toast(error.message);
    }
  });
  $("#esp32CameraPanel").addEventListener("toggle", (event) => {
    if (!event.target.open) studioCamera.dispose();
    else renderStudioCamera();
  });
  // 장치 프로필을 바꾸면 이전 생성 결과를 무효화합니다.
  $("#deviceProfileSelect").addEventListener("change", (e) => {
    state.deviceProfile = e.target.value;
    localStorage.setItem("phyvibe.deviceProfile", state.deviceProfile);
    state.generationValid = false;
    $("#exportBtn").disabled = true;
    state.widgets = [];
    renderWidgets();
    toast("장치 프로필 변경 · 해당 MakeCode 프로그램을 업로드하고 웹앱을 다시 생성하세요");
  });
  // 생성 요청과 라이브·코드·스키마 화면 전환
  $("#generateBtn").addEventListener("click", generate);
  $("#promptInput").addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") generate();
  });
  $$("#viewTabs button").forEach((button) =>
    button.addEventListener("click", () => switchView(button.dataset.view)),
  );
  $$("[data-width]").forEach((button) =>
    button.addEventListener("click", () => {
      $$("[data-width]").forEach((b) => b.classList.toggle("active", b === button));
      $("#previewFrame").classList.remove("desktop", "tablet", "mobile");
      $("#previewFrame").classList.add(button.dataset.width);
    }),
  );
  $$(".mobile-tabs button").forEach((button) =>
    button.addEventListener("click", () => {
      $$(".mobile-tabs button").forEach((b) => b.classList.toggle("active", b === button));
      $$(".studio-grid > .panel").forEach((p) =>
        p.classList.toggle("mobile-active", p.id === button.dataset.panel),
      );
    }),
  );
  // 슬라이더 상태 갱신과 제어 버튼의 명령 전송
  $("#widgetGrid").addEventListener("input", (e) => {
    if (!e.target.matches("[data-control]")) return;
    const widget = state.widgets.find((w) => w.id === e.target.dataset.control);
    widget.value = Math.min(
      Number(widget.max),
      Math.max(Number(widget.min), Math.round(Number(e.target.value))),
    );
    e.target.closest(".widget").querySelector("[data-control-value]").textContent = widget.value;
  });
  $("#widgetGrid").addEventListener("click", (e) => {
    if (e.target.dataset.commands) {
      (async () => {
        for (const command of e.target.dataset.actions
          ? resolveButtonCommands(JSON.parse(e.target.dataset.actions), state.widgets)
          : JSON.parse(e.target.dataset.commands)) {
          if (!(await sendNetwork(command, true))) break;
        }
      })();
      return;
    }
    const command = e.target.dataset.command;
    if (!command) return;
    const current = e.target.closest(".widget")?.querySelector("[data-control-value]")?.textContent;
    if (!current || e.target.dataset.controlAction === "stop") return sendNetwork(command);
    sendNetwork(
      command.startsWith("MOT:")
        ? `MOT:${current}:${current}`
        : command.replace(/:-?\d+(?:\.\d+)?$/, `:${current}`),
    );
  });
  // 브릿지 연결, 수동 송신과 네트워크 로그
  $("#bridgeUrlInput").addEventListener("change", () => {
    if ($("#bridgeToggle").checked) toggleBridge(true);
  });
  $("#bridgeToggle").addEventListener("change", (e) => toggleBridge(e.target.checked));
  $("#sendTxBtn").addEventListener("click", () => {
    sendNetwork($("#txInput").value);
    $("#txInput").value = "";
  });
  $("#txInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#sendTxBtn").click();
  });
  $("#clearLogsBtn").addEventListener("click", () => {
    state.logs = [];
    $("#terminal").innerHTML = "";
  });
  // AI 공급자 설정과 API 연결 확인
  $("#settingsBtn").addEventListener("click", () => {
    $("#providerSelect").value = state.provider;
    $("#llmUrlInput").value = QWEN_BASE_URL;
    updateModelOptions();
    $("#apiKeyInput").value = state.apiKey;
    $("#settingsDialog").showModal();
  });
  $("#providerSelect").addEventListener("change", updateModelOptions);
  $("#revealKeyBtn").addEventListener("click", () => {
    const input = $("#apiKeyInput");
    input.type = input.type === "password" ? "text" : "password";
  });
  $("#testApiBtn").addEventListener("click", testApi);
  $("#saveSettingsBtn").addEventListener("click", async (e) => {
    e.preventDefault();
    if ($("#providerSelect").value === "qwen") {
      try {
        await configureQwenUrl($("#llmUrlInput").value);
      } catch (error) {
        toast(error.message);
        return;
      }
    }
    state.provider = $("#providerSelect").value;
    state.model = $("#modelSelect").value;
    state.apiKey = $("#apiKeyInput").value.trim();
    localStorage.setItem("phyvibe.provider", state.provider);
    localStorage.setItem("phyvibe.model", state.model);
    localStorage.setItem("phyvibe.apiKey", state.apiKey);
    $("#settingsDialog").close();
    clearTimeout(qwenRetryTimer);
    updateProviderStatus();
    if (state.provider === "qwen") startQwenGate();
    toast("AI 설정을 이 브라우저에 저장했습니다");
  });
  // 웹앱 다운로드, 코드 복사와 화면 도구
  $("#exportBtn").addEventListener("click", downloadProject);
  $("#copyCodeBtn").addEventListener("click", () =>
    navigator.clipboard
      .writeText($("#codeContent").textContent)
      .then(() => toast("코드를 복사했습니다")),
  );
  $("#copySchemaBtn").addEventListener("click", () =>
    navigator.clipboard
      .writeText($("#schemaContent").textContent)
      .then(() => toast("스키마를 복사했습니다")),
  );
  $("#refreshPreview").addEventListener("click", () => {
    renderWidgets();
    toast("라이브 뷰를 새로고침했습니다");
  });
  $("#fullscreenBtn").addEventListener("click", () => $("#canvasPanel").requestFullscreen?.());
  $("#newChatBtn").addEventListener("click", () => {
    $("#conversation").innerHTML = "";
    appendMessage("ai", "새 프로젝트를 시작할 준비가 됐어요. 무엇을 만들까요?");
  });
  // 시작 화면의 Qwen 재접속 또는 명시적인 데모 전환
  $("#returnToQwenBtn").addEventListener("click", returnToLocalQwen);
  $("#retryQwenBtn").addEventListener("click", async () => {
    try {
      await configureQwenUrl($("#startupLlmUrlInput").value);
      returnToLocalQwen();
    } catch (error) {
      $("#qwenStartupMessage").textContent = error.message;
    }
  });
  $("#demoModeBtn").addEventListener("click", () => {
    state.provider = "demo";
    state.model = "rule-engine";
    localStorage.setItem("phyvibe.provider", "demo");
    clearTimeout(qwenRetryTimer);
    $("#qwenStartupDialog").close();
    updateProviderStatus();
    toast("데모 모드 · LLM 요청 없이 실행합니다");
  });
  $("#qwenStartupDialog").addEventListener("cancel", (event) => event.preventDefault());
}

// 초기 화면 구성: 프로필 복원 → UI 이벤트 등록 → 설정 표시 → Qwen 연결 확인.
$("#deviceProfileSelect").innerHTML = Object.entries(SKILL_CATALOG.profiles)
  .map(([id, profile]) => `<option value="${id}">${escapeHtml(profile.label)}</option>`)
  .join("");
if (!SKILL_CATALOG.profiles[state.deviceProfile]) state.deviceProfile = "legacy";
$("#deviceProfileSelect").value = state.deviceProfile;
if (typeof window !== "undefined")
  window.addEventListener(
    "pagehide",
    () => {
      studioVision.dispose();
      studioCamera.dispose();
    },
    { once: true },
  );
renderWidgets();
bindEvents();
$("#esp32CameraUrl").value = state.cameraUrl;
renderStudioCamera();
$("#exportBtn").disabled = true;
$("#bridgeUrlInput").value = state.bridgeUrl;
$("#llmUrlInput").value = QWEN_BASE_URL;
$("#startupLlmUrlInput").value = QWEN_BASE_URL;
addLog("SYS", "Network monitor ready · received network packets only");
updateProviderStatus();
startQwenGate();
