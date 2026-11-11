/**
 * 자연어 해석과 실행 구성을 나누는 의도 계약 및 컴파일러.
 *
 * LLM: 사용자가 원하는 기능과 의미 있는 값만 반환합니다.
 * JavaScript: 입력 검증 → 장치 권한 확인 → ID/위젯/참조/명령 구성.
 * 프롬프트 문구별 예외는 두지 않습니다. 새 기능은 스키마와 빌더에 추가합니다.
 * 이 파일은 에디터에서만 필요하며 내보낸 앱은 완성된 위젯으로 실행합니다.
 */
const APP_INTENT_VERSION = 1;

// 모델 안내와 실제 검증이 같은 스키마를 사용하도록 계약을 한 곳에 둡니다.
const APP_INTENT_SCHEMA = (() => {
  const text = { type: "string", maxLength: 256 };
  const label = { type: "string", minLength: 1, maxLength: 80 };
  const speed = { type: "integer", minimum: 0, maximum: 80 };
  const angle = { type: "integer", minimum: 0, maximum: 180 };
  const choice = (...values) => ({ type: "string", enum: values });
  const list = (items, minItems = 0, maxItems = 8) => ({
    type: "array",
    items,
    minItems,
    maxItems,
  });
  const object = (properties, required = []) => ({
    type: "object",
    properties,
    required,
    additionalProperties: false,
  });
  const feature = (kind, properties, required = []) =>
    object({ kind: { const: kind }, title: label, ...properties }, ["kind", ...required]);
  const camera = { input: choice("configured", "esp32", "webcam"), url: text };
  const direction = choice("forward", "backward", "left", "right", "stop");
  const target = choice("servo", "valve", "mouth");
  const effect = {
    oneOf: [
      feature("transmit_text", { text }, ["text"]),
      feature("motor_speed", { speed }, ["speed"]),
      feature("drive", { direction, speed }, ["direction", "speed"]),
      feature("servo_angle", { target, angle }, ["target", "angle"]),
    ],
  };
  const features = [
    feature("camera", camera),
    feature(
      "classifier",
      {
        ...camera,
        model: choice("mobilenet"),
        classes: { ...list({ type: "string", minLength: 1, maxLength: 40 }, 2), uniqueItems: true },
        confidence: { type: "number", minimum: 0.5, maximum: 0.99 },
        deviceRules: {
          ...list(object({ label, effect }, ["label", "effect"])),
          description:
            "Optional physical device commands after classification. Omit unless the user explicitly requests device transmission or motor/servo actuation. Classification results already display automatically without any deviceRules.",
        },
        game: object(
          { beats: list(list(label, 2, 2), 1, 28), winText: text, lossText: text, drawText: text },
          ["beats"],
        ),
      },
      ["classes"],
    ),
    feature(
      "motor",
      {
        speedControl: choice("slider", "fixed"),
        speed,
        min: speed,
        max: speed,
        directions: { ...list(direction, 1, 5), uniqueItems: true },
      },
      ["speedControl"],
    ),
    feature(
      "servo",
      { target, control: { const: "slider" }, min: angle, max: angle, value: angle },
      ["target", "control"],
    ),
    feature("servo", { target, control: { const: "buttons" }, angles: list(angle, 1) }, [
      "target",
      "control",
      "angles",
    ]),
    feature(
      "sensor",
      {
        key: { type: "string", pattern: "^[a-zA-Z0-9_-]+$", minLength: 1, maxLength: 80 },
        view: choice("metric", "gauge", "chart", "alert"),
        unit: text,
        min: { type: "number" },
        max: { type: "number" },
        threshold: { type: "number" },
      },
      ["key"],
    ),
    feature("macro", { effects: list(effect, 1) }, ["effects"]),
  ];
  return object(
    {
      version: { const: APP_INTENT_VERSION },
      title: label,
      features: list({ oneOf: features }),
      unsupported: list(label),
    },
    ["version", "title", "features"],
  );
})();

// 위 계약에 사용하는 JSON Schema 키워드만 검증합니다.
// 모델에도 같은 스키마를 전달하며 widget/id/skill 등 정의되지 않은 필드는 거부합니다.
function validateAppIntent(value, schema = APP_INTENT_SCHEMA, path = "intent") {
  const fail = (message) => {
    throw new Error(`${path}: ${message}`);
  };
  if (schema.oneOf) {
    const variant = schema.oneOf.find((item) =>
      Object.entries(item.properties)
        .filter(([, property]) => Object.hasOwn(property, "const"))
        .every(([key, property]) => value?.[key] === property.const),
    );
    if (!variant) fail(`unsupported kind ${JSON.stringify(value?.kind)}`);
    return validateAppIntent(value, variant, path);
  }
  if (Object.hasOwn(schema, "const") && value !== schema.const) fail(`must equal ${schema.const}`);
  if (schema.enum && !schema.enum.includes(value)) fail(`must be one of ${schema.enum.join(", ")}`);
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("must be an object");
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) fail(`missing ${key}`);
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, key))
        fail(`unknown field ${key}; return intent, not widget configuration`);
      validateAppIntent(item, schema.properties[key], `${path}.${key}`);
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) fail("must be an array");
    if (value.length < schema.minItems || value.length > schema.maxItems)
      fail(`requires ${schema.minItems}–${schema.maxItems} items`);
    if (schema.uniqueItems && new Set(value).size !== value.length) fail("duplicate values");
    value.forEach((item, index) => validateAppIntent(item, schema.items, `${path}[${index}]`));
  } else if (schema.type === "string") {
    if (typeof value !== "string") fail("must be a string");
    if (schema.minLength && !value.trim()) fail("must not be empty");
    if (value.length < (schema.minLength || 0) || value.length > schema.maxLength)
      fail("invalid string length");
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail("invalid characters");
  } else if (schema.type === "integer" || schema.type === "number") {
    if (!Number.isFinite(value) || (schema.type === "integer" && !Number.isInteger(value)))
      fail(`must be a finite ${schema.type}`);
    if (value < schema.minimum || value > schema.maximum)
      fail(`outside ${schema.minimum}..${schema.maximum}`);
  } else if (schema.type === "boolean" && typeof value !== "boolean") fail("must be a boolean");
  return value;
}

// 문장의 의미는 읽지 않습니다. URL 리터럴만 추출하여 모델이 주소를 지어내는 것을 방지합니다.
function appIntentContext(prompt, cameraUrl = "") {
  return {
    cameraUrl,
    explicitCameraUrls: [...new Set(prompt.match(/https?:\/\/[^\s<>"']+/gi) || [])],
  };
}

function intentCameraSource(feature, context) {
  const input = feature.input || "configured";
  if (input === "webcam") {
    if (feature.url) throw new Error("Webcam input cannot have a network URL");
    return { type: "webcam" };
  }
  let url = feature.url || context.explicitCameraUrls[0] || context.cameraUrl || "";
  if (feature.url) {
    const requested = normalizeVisionSource({ type: "esp32_stream", url: feature.url }).url;
    const allowed = [context.cameraUrl, ...context.explicitCameraUrls]
      .filter(Boolean)
      .map((value) => normalizeVisionSource({ type: "esp32_stream", url: value }).url);
    if (!allowed.includes(requested))
      throw new Error("Camera URL must come from editor settings or the user's explicit URL");
    url = requested;
  }
  if (input === "configured" && !url && feature.kind === "classifier") return { type: "webcam" };
  return normalizeVisionSource({ type: "esp32_stream", url });
}

// 의도의 효과를 허용된 스킬로 변환합니다. 명령 문자열은 기존 검증층이 생성합니다.
function intentEffect(effect, profile) {
  const builders = {
    transmit_text: () => ({ skill: "send_text", text: effect.text }),
    motor_speed: () => ({ skill: "set_motor", speed: effect.speed }),
    drive: () => ({
      skill: "drive_motor",
      direction: effect.direction,
      speed: effect.direction === "stop" ? 0 : effect.speed,
    }),
    servo_angle: () => ({ skill: "set_servo", target: effect.target, angle: effect.angle }),
  };
  const action = builders[effect.kind]();
  if (!profile.skills.includes(action.skill))
    throw new Error(`Device profile does not support ${action.skill}`);
  return action;
}

function compileAppIntent(intent, context, profile) {
  validateAppIntent(intent);
  if (intent.unsupported?.length) {
    const error = new Error(`현재 지원하지 않는 기능: ${intent.unsupported.join(", ")}`);
    error.name = "UnsupportedIntentError";
    throw error;
  }
  if (!intent.features.length) throw new Error("앱에 필요한 기능이 없습니다.");
  const widgets = [];
  const add = (widget) => widgets.push({ ...widget, id: `feature-${widgets.length + 1}` });
  const names = {
    forward: "전진",
    backward: "후진",
    left: "좌회전",
    right: "우회전",
    stop: "정지",
  };
  const sources = new Map();
  for (const feature of intent.features) {
    if (["camera", "classifier"].includes(feature.kind))
      sources.set(feature, intentCameraSource(feature, context));
  }
  // classifier에는 이미 영상 표시가 있습니다. 같은 입력의 단순 미리보기를 중복 생성하지 않습니다.
  const classified = new Set(
    intent.features
      .filter((f) => f.kind === "classifier")
      .map((f) => JSON.stringify(sources.get(f))),
  );
  const previews = new Set();
  for (const feature of intent.features) {
    const title = feature.title;
    switch (feature.kind) {
      case "camera": {
        const source = sources.get(feature),
          key = JSON.stringify(source);
        if (classified.has(key) || previews.has(key)) break;
        previews.add(key);
        add({
          type: "camera_stream",
          title: title || "카메라",
          action: { skill: "camera_stream", source },
        });
        break;
      }
      case "classifier":
        add({
          type: "classifier",
          title: title || "카메라 이미지 분류",
          action: {
            skill: "image_classifier",
            model: feature.model || "mobilenet",
            source: sources.get(feature),
            classes: feature.classes,
            confidence: feature.confidence ?? 0.8,
            rules: (feature.deviceRules || []).map((rule) => ({
              label: rule.label,
              ...intentEffect(rule.effect, profile),
            })),
            ...(feature.game ? { game: feature.game } : {}),
          },
        });
        break;
      case "motor": {
        const slider = feature.speedControl === "slider";
        const speed = feature.speed ?? 50;
        let speedFrom;
        if (slider) {
          speedFrom = `feature-${widgets.length + 1}`;
          add({
            type: "control",
            title: title || "모터 속도",
            min: feature.min ?? 0,
            max: feature.max ?? 80,
            value: speed,
            action: { skill: "set_motor" },
          });
        }
        if (feature.directions?.length) {
          const directions = new Set(feature.directions);
          for (const direction of ["forward", "left", "right", "backward", "stop"].filter((d) =>
            directions.has(d),
          ))
            add({
              type: "button",
              title: names[direction],
              actions: [
                {
                  skill: "drive_motor",
                  direction,
                  ...(direction === "stop" ? { speed: 0 } : slider ? { speedFrom } : { speed }),
                },
              ],
            });
        } else {
          add({
            type: "button",
            title: "모터 동작",
            actions: [{ skill: "set_motor", ...(slider ? { speedFrom } : { speed }) }],
          });
          add({
            type: "button",
            title: "모터 정지",
            actions: [{ skill: "set_motor", speed: 0 }],
          });
        }
        break;
      }
      case "servo":
        if (feature.control === "slider") {
          if (feature.angles) throw new Error("Servo angles belong to button control");
          add({
            type: "control",
            title: title || "서보 각도",
            action: { skill: "set_servo", target: feature.target },
            min: feature.min ?? 0,
            max: feature.max ?? 180,
            value: feature.value ?? 90,
          });
        } else {
          if (!feature.angles?.length) throw new Error("Servo buttons require angles");
          for (const angle of feature.angles)
            add({
              type: "button",
              title: `${title || "서보"} ${angle}°`,
              actions: [
                intentEffect({ kind: "servo_angle", target: feature.target, angle }, profile),
              ],
            });
        }
        break;
      case "sensor":
        add({
          type: feature.view || "metric",
          title: title || feature.key,
          unit: feature.unit || "",
          value: 0,
          min: feature.min ?? 0,
          max: feature.max ?? 100,
          threshold: feature.threshold ?? 10,
          ...(feature.view === "chart" ? { points: [0, 0] } : {}),
          action: { skill: "display_sensor", key: feature.key },
        });
        break;
      case "macro":
        add({
          type: "button",
          title: title || "명령 전송",
          actions: feature.effects.map((effect) => intentEffect(effect, profile)),
        });
        break;
      default:
        throw new Error(`No compiler registered for intent kind ${feature.kind}`);
    }
  }
  if (widgets.length > 8)
    throw new Error(
      `이 앱에는 위젯 ${widgets.length}개가 필요합니다. 현재 최대 8개까지 지원합니다. 기능을 줄여 주세요.`,
    );
  return { title: intent.title, widgets: normalizeWidgets(widgets, profile) };
}

function appIntentSystemPrompt(profile, context) {
  return `You interpret user intent for PhyVibe. Return JSON only matching this schema: ${JSON.stringify(APP_INTENT_SCHEMA)}.
Return version 1, a Korean title, features, and unsupported (empty when fully supported).
Describe requested capabilities and semantic values only. Never output widget, id, action, skill, speedFrom, command, JavaScript or generated CMD text. JavaScript builds all UI, IDs, references and protocol commands.
Supported device capabilities: ${JSON.stringify(profile)}. Browser capabilities: direct ESP32 camera preview, PC webcam, MobileNet CNN image classification with local sample collection/training/inference, optional class-label effects or class-pair game. No video relay. Qwen never receives images.
Context: ${JSON.stringify(context)}. Use input configured for the editor camera or an explicit URL in the user's request; use webcam only when explicitly requested. Never invent camera URLs.
One camera feature includes its display and streaming start/stop buttons. Do not add macros for camera controls. Deduplicate repeated requests. Camera viewing and motor control are independent features and can coexist. No motor feature unless requested. A classifier already includes preview, sampling, training and inference; no separate camera feature is necessary.
Interpret negation: "이미지 분류는 하지 마세요" and "CNN은 사용하지 마세요" mean camera preview, no classifier. Interpret 전지후진 as 전진/후진, 좌우회전 as left and right. Do not infer manual motor controls solely from classifier rules.
For motor, include directions forward/backward/left/right/stop only for directional robot control. Without directions, it is plain speed control; JavaScript provides standard run and stop controls. Do not output run or stop booleans. For directional control, include stop in directions when requested. One motor feature describes its speed setting and all associated movement controls; do not split a speed slider into another motor feature. Shared speed slider means speedControl slider; otherwise fixed. Initial speed defaults to 50, range 0..80. Stop is 0. Do not generate slider references, button widgets, or macros for motor directions. Include all requested directions and stop. Servo target is servo/valve/mouth, angle 0..180. A servo slider uses control slider with min/max/value only; servo presets use control buttons with angles only. Never put angles on a slider.
For classifier use the user's exact class labels, 2..8 classes, confidence default 0.8; deviceRules contain label and a PHYSICAL DEVICE effect. Effects are transmit_text to send the exact explicitly requested payload through the hardware bridge to micro:bit, motor_speed with speed, drive with direction/speed, or servo_angle with target/angle. Omit deviceRules for display-only classification. Prediction labels and confidence ALREADY display automatically; do not create transmit_text rules just to display results. Never invent device output commands or payloads. Preserve literal text case and spaces. Rules use fixed values. Choose deviceRules OR game. Game beats are [winner,loser] for each class pair; game texts default empty.
For sensors preserve the user's exact English key; choose metric/gauge/chart/alert. Use macro ONLY for requested literal text messages or explicitly requested ordered command sequences. Ordinary motor direction buttons are already represented by motor.directions, and servo controls by servo; do NOT duplicate them as macros. Preserve literal text and action order in effects. Do not replace literal text with invented motor commands.
Unsupported capabilities (OpenCV, autonomous line following, object location/count detection, OCR, ViT, YOLO, segmentation) go into unsupported; do not silently substitute classification or omit them.
Example camera-only intent: {"version":1,"title":"카메라","features":[{"kind":"camera","input":"configured"}],"unsupported":[]}.
Example camera remote intent: {"version":1,"title":"카메라 로봇 조종","features":[{"kind":"camera","input":"configured"},{"kind":"motor","speedControl":"slider","speed":50,"directions":["forward","backward","left","right","stop"]}],"unsupported":[]}.
/no_think`;
}
