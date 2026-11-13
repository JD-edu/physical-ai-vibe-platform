const assert = require("node:assert/strict");
const { context, run, compile, responses, requests } = require("./intent_context.cjs")();
const source = "http://192.168.0.123/stream";
const intent = (features) => ({ version: 1, title: "테스트", features, unsupported: [] });
const camera = { kind: "camera", input: "configured" };
const classifier = { kind: "classifier", input: "configured", classes: ["물체 있음", "물체 없음"] };
const motor = {
  kind: "motor",
  speedControl: "slider",
  directions: ["forward", "backward", "left", "right", "stop"],
};
const remotePrompt =
  "이 카메라 영상을 보면서 로봇을 수동 조종하는 웹앱을 만들어 주세요. 전진·후진·좌회전·우회전 버튼을 십자 모양으로 배치하고 별도의 정지 버튼을 넣어 주세요. 모터 속도는 0부터 80까지의 슬라이더 하나로 설정하고 모든 방향 버튼이 현재 슬라이더 값을 사용하도록 해 주세요. 영상은 보기만 하고 이미지 분류는 하지 마세요.";
const cameraPrompt =
  "웹앱을 만들어 주세요. 카메라를 사용합니다. 카메라 스트리밍 시작하는 버튼과 종료하는 버튼 그리고카메라 디스플레이 배치해 주세요".repeat(
    2,
  );
const preview = compile([camera]);
assert.equal(preview.widgets.length, 1);
assert.equal(preview.widgets[0].action.source.url, source);
context.preview = preview.widgets[0];
const markup = run("renderVisionWidget(preview)");
assert(
  markup.includes('data-vision="start"') &&
    markup.includes('data-vision="stop"') &&
    markup.includes("data-esp32-preview"),
);
assert(!markup.includes('data-vision="train"'));
assert.equal(
  compile([{ kind: "camera", input: "webcam" }]).widgets[0].action.source.type,
  "webcam",
);
assert.equal(compile([{ ...classifier, input: "webcam" }]).widgets[0].action.source.type, "webcam");
assert.equal(
  compile([camera, camera, classifier]).widgets.length,
  1,
  "classifier owns preview for its input",
);
const cnn = compile([
  {
    ...classifier,
    deviceRules: [
      { label: "물체 있음", effect: { kind: "drive", direction: "forward", speed: 35 } },
      { label: "물체 없음", effect: { kind: "drive", direction: "stop", speed: 50 } },
    ],
  },
]).widgets[0];
assert.equal(cnn.action.rules[0].text, "CMD:motor:forward:35");
assert.equal(cnn.action.rules[1].text, "CMD:motor:stop:0");
context.config = cnn.action;
assert.equal(run('visionDecision(config,"물체 있음",0.95).text'), "CMD:motor:forward:35");
assert.equal(run('visionDecision(config,"物",0.95).text'), "");
assert.equal(run('visionDecision(config,"물체 있음",0.1).text'), "");
assert.equal(
  compile([
    {
      ...classifier,
      deviceRules: [{ label: "물체 있음", effect: { kind: "servo_angle", target: "servo", angle: 150 } }],
    },
  ]).widgets[0].action.rules[0].text,
  "CMD:servo:150",
);
const game = {
  kind: "classifier",
  classes: ["rock", "paper", "scissors"],
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
};
context.config = compile([game]).widgets[0].action;
assert.equal(run('visionDecision(config,"rock",0.99,"scissors").text'), "O");
assert.equal(run('visionDecision(config,"rock",0.99,"paper").text'), "x");
assert.equal(
  compile([{ kind: "macro", effects: [{ kind: "transmit_text", text: " O x " }] }]).widgets[0].actions[0]
    .text,
  " O x ",
);
for (const view of ["metric", "gauge", "chart", "alert"])
  assert.equal(
    compile([{ kind: "sensor", key: "temperature", view }]).widgets[0].sensorKey,
    "temperature",
  );
assert.equal(
  compile([{ kind: "servo", target: "servo", control: "slider", value: 90 }]).widgets[0].value,
  90,
);
assert.equal(
  compile([{ kind: "servo", target: "servo", control: "buttons", angles: [30, 150] }]).widgets[1]
    .actions[0].text,
  "CMD:servo:150",
);
for (const invalid of [
  [{ ...camera, id: "llm-id" }],
  [{ ...motor, speedFrom: "llm-slider" }],
  [{ ...classifier, model: "vit" }],
  [{ ...motor, speed: 81 }],
  [{ kind: "servo", target: "servo", control: "slider", value: 181 }],
  [{ kind: "macro", effects: [{ kind: "transmit_text", text: "a\nb" }] }],
  [{ ...classifier, classes: ["same", "same"] }],
  [{ ...classifier, deviceRules: [{ label: "unknown", effect: { kind: "transmit_text", text: "a" } }] }],
  [
    {
      ...classifier,
      deviceRules: [{ label: "物", effect: { kind: "transmit_text", text: "a" } }],
      game: game.game,
    },
  ],
  [{ ...camera, url: "http://invented/stream" }],
  [{ ...camera, url: "javascript:bad" }],
  [{ ...camera, input: "webcam", url: source }],
  [{ kind: "opencv" }],
])
  assert.throws(() => compile(invalid));
assert.throws(() => compile([camera], { widgets: [] }), /unknown field/);
assert.throws(() => compile([camera], { unsupported: ["OCR"] }), /현재 지원하지 않는 기능/);
assert.throws(() => compile([{ ...motor }, { ...motor }]), /최대 8개/);
context.plan = intent([{ kind: "servo", target: "servo", control: "slider" }]);
assert.throws(
  () => run('compileAppIntent(plan,appIntentContext("",state.cameraUrl),{skills:["send_text"]})'),
  /unavailable/,
);
context.plan = intent([
  {
    ...classifier,
    deviceRules: [{ label: "물체 있음", effect: { kind: "drive", direction: "forward", speed: 30 } }],
  },
]);
assert.throws(
  () => run('compileAppIntent(plan,appIntentContext("",state.cameraUrl),{skills:["send_text"]})'),
  /does not support/,
);
context.plan = intent([{ kind: "macro", effects: [{ kind: "transmit_text", text: "x" }] }]);
assert.throws(
  () =>
    run(
      'compileAppIntent(plan,appIntentContext("",state.cameraUrl),{skills:["send_text"],textCommands:["O"]})',
    ),
  /supported text/,
);
context.plan = intent([{ ...camera, url: "http://explicit/stream" }]);
assert.equal(
  run(
    'compileAppIntent(plan,appIntentContext("카메라 http://explicit/stream",state.cameraUrl),SKILL_CATALOG.profiles.esp32).widgets[0].action.source.url',
  ),
  "http://explicit/stream",
);
assert.equal(run('widgetsFromPrompt("카메라 영상")[0].type'), "camera_stream");
assert.equal(run('widgetsFromPrompt("서보 조종")[0].action.skill'), "set_servo");
assert.equal(run('widgetsFromPrompt("토양 급수")[0].sensorKey'), "soil");
console.log(
  "PASS: intent schema, camera/CNN distinction, deduplication, labels/games/effects, profiles, literals, explicit URLs, unsupported features, widget limits.",
);
(async () => {
  for (const prompt of [
    remotePrompt,
    cameraPrompt,
    "이 카메라 영상만 보여 주세요. CNN은 사용하지 마세요.",
  ]) {
    responses.push(intent(prompt === remotePrompt ? [camera, motor] : [camera]));
    context.prompt = prompt;
    const result = await run("generateWithQwen(prompt)");
    assert.equal(result.widgets.length, prompt === remotePrompt ? 7 : 1);
  }
  const system = requests[0].messages[0].content;
  assert(system.includes("JavaScript builds all UI"));
  assert(!system.includes("EXACT_SLIDER_ID"));
  responses.push({ title: "old widget plan", widgets: [] }, intent([camera]));
  assert.equal((await run('generateWithQwen("카메라 보기")')).widgets.length, 1);
  assert(requests.at(-1).messages.at(-1).content.includes("Intent validation failed"));
  const before = requests.length;
  responses.push(intent([]));
  responses.at(-1).unsupported = ["OCR"];
  await assert.rejects(() => run('generateWithQwen("OCR 웹앱")'), /현재 지원하지 않는 기능/);
  assert.equal(
    requests.length,
    before + 1,
    "unsupported intents do not get rewritten into another app",
  );
  console.log(
    "PASS: Qwen returns semantic intent only; generic correction; no prompt-specific repair or unsupported fallback.",
  );
  if (process.env.REAL_QWEN === "1" || process.argv.includes("--real-qwen")) {
    const base = process.env.QWEN_TEST_URL || "http://127.0.0.1:8080";
    const response = await fetch(base + "/v1/models", { signal: AbortSignal.timeout(5000) });
    assert(response.ok);
    context.model = (await response.json()).data[0].id;
    context.base = base;
    context.fetch = fetch;
    run("QWEN_BASE_URL=base;state.qwenModelId=model");
    const cases = [
      [
        cameraPrompt,
        (result) => {
          assert.equal(result.widgets.length, 1);
          assert.equal(result.widgets[0].type, "camera_stream");
        },
      ],
      [
        remotePrompt,
        (result) => {
          assert.equal(result.widgets.length, 7);
          assert(result.widgets.some((w) => w.type === "camera_stream"));
          assert(!result.widgets.some((w) => w.type === "classifier"));
        },
      ],
      [
        "이 카메라 영상을 표시하는 웹앱을 만들어 주세요. CNN은 사용하지 마세요.",
        (result) => assert.equal(result.widgets[0].type, "camera_stream"),
      ],
      [
        "이 카메라와 CNN으로 양품과 불량을 분류하는 웹앱을 만들어 주세요. 결과만 화면에 보여 주세요.",
        (result) => {
          assert.equal(result.widgets.length, 1);
          assert.equal(result.widgets[0].type, "classifier");
          assert.equal(result.widgets[0].action.rules.length, 0);
          assert(result.widgets[0].action.classes.includes("양품"));
        },
      ],
      [
        "이 카메라와 CNN으로 물체 있음, 물체 없음 두 클래스를 학습하세요. 물체 있음이면 모터 전진 속도 35, 물체 없음이면 모터 정지 속도 0으로 제어하세요.",
        (result) => {
          assert.equal(result.widgets.length, 1);
          assert(
            result.widgets[0].action.rules.some((rule) => rule.text === "CMD:motor:forward:35"),
          );
          assert(result.widgets[0].action.rules.some((rule) => rule.text === "CMD:motor:stop:0"));
        },
      ],
      [
        "PC 웹캠으로 손 펼침, 주먹, 손 없음 세 클래스를 학습하고 분류 결과만 보여 주세요.",
        (result) => assert.equal(result.widgets[0].action.source.type, "webcam"),
      ],
      [
        "버튼을 누르면 마이크로비트에 대문자 O, 소문자 x를 각각 보내는 버튼 두 개를 만들어 주세요.",
        (result) =>
          assert.deepEqual(
            Array.from(result.widgets.flatMap((w) => w.actions.map((a) => a.text)).sort()),
            ["O", "x"],
          ),
      ],
      [
        "servo 각도를 0부터 180까지 조절하는 슬라이더를 만들어 주세요. 초기값은 90도입니다.",
        (result) => {
          assert.equal(result.widgets[0].action.skill, "set_servo");
          assert.equal(result.widgets[0].value, 90);
        },
      ],
    ];
    for (const [prompt, check] of cases) {
      context.prompt = prompt;
      const result = await run("generateWithQwen(prompt)");
      check(result);
      console.log("PASS: real Qwen intent -> compiled app: " + prompt);
    }
    await assert.rejects(
      () => run('generateWithQwen("이 카메라로 OCR 문자 인식 웹앱을 만들어 주세요.")'),
      /현재 지원하지 않는 기능/,
    );
    console.log("PASS: real Qwen unsupported OCR is reported explicitly.");
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
