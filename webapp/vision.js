// Reusable browser vision workflow. Qwen supplies data, never executable code.
function normalizeVisionWidget(item, profile) {
  const config = item.action;
  if (config?.skill !== "image_classifier")
    throw new Error("classifier requires image_classifier action");
  if (config.model != null && config.model !== "mobilenet")
    throw new Error("image_classifier supports only model mobilenet");
  const source = normalizeVisionSource(config.source);
  const classes = config.classes;
  if (
    !Array.isArray(classes) ||
    classes.length < 2 ||
    classes.length > 8 ||
    classes.some((x) => typeof x !== "string" || !x.trim() || x.length > 40) ||
    new Set(classes).size !== classes.length
  )
    throw new Error("classifier requires 2–8 unique nonempty class labels");
  const text = (value) => {
    if (typeof value !== "string" || value.length > 256 || /[\r\n]/.test(value))
      throw new Error("classifier command must be a single-line string of at most 256 characters");
    if (
      value &&
      (!profile.skills.includes("send_text") ||
        (profile.textCommands && !profile.textCommands.includes(value)))
    )
      throw new Error(
        `This device profile cannot send ${JSON.stringify(value)}; check the ESP32 command handler`,
      );
    return value;
  };
  const confidence = config.confidence ?? 0.8;
  if (!Number.isFinite(confidence) || confidence < 0.5 || confidence > 0.99)
    throw new Error("confidence must be 0.5–0.99");
  const rules = config.rules ?? [];
  if (!Array.isArray(rules) || rules.length > 8)
    throw new Error("classifier supports at most 8 label rules");
  const normalizedRules = rules.map((rule) => {
    if (!classes.includes(rule?.label)) throw new Error("label rule requires a known class label");
    if (!profile.skills.includes(rule.skill))
      throw new Error(`Classifier rule skill ${rule.skill} is unavailable`);
    if (rule.skill === "send_text")
      return { label: rule.label, skill: rule.skill, text: text(rule.text) };
    if (rule.speedFrom !== undefined)
      throw new Error("Classifier rules use fixed values, not speedFrom");
    if (rule.skill === "set_motor" || rule.skill === "drive_motor") {
      if (
        rule.skill === "drive_motor" &&
        !["forward", "backward", "left", "right", "stop"].includes(rule.direction)
      )
        throw new Error("Classifier drive_motor rule requires a supported direction");
      const speed = rule.skill === "drive_motor" && rule.direction === "stop" ? 0 : rule.speed;
      if (!Number.isInteger(speed) || speed < 0 || speed > 80)
        throw new Error("Classifier motor speed must be integer 0..80");
      return {
        label: rule.label,
        skill: rule.skill,
        speed,
        ...(rule.skill === "drive_motor" ? { direction: rule.direction } : {}),
        text:
          rule.skill === "drive_motor"
            ? `CMD:motor:${rule.direction}:${speed}`
            : `CMD:motor:${speed}`,
      };
    }
    if (rule.skill === "set_servo") {
      if (
        !["servo", "valve", "mouth"].includes(rule.target) ||
        (profile.servoTargets && !profile.servoTargets.includes(rule.target))
      )
        throw new Error("Classifier servo target is unavailable");
      if (!Number.isInteger(rule.angle) || rule.angle < 0 || rule.angle > 180)
        throw new Error("Classifier servo angle must be integer 0..180");
      return {
        label: rule.label,
        skill: rule.skill,
        target: rule.target,
        angle: rule.angle,
        text: `CMD:${rule.target}:${rule.angle}`,
      };
    }
    throw new Error("Classifier rules support send_text, set_motor, drive_motor or set_servo");
  });
  if (new Set(normalizedRules.map((r) => r.label)).size !== normalizedRules.length)
    throw new Error("duplicate label rules");
  let game;
  if (config.game != null) {
    const input = config.game;
    if (
      !Array.isArray(input.beats) ||
      input.beats.length !== (classes.length * (classes.length - 1)) / 2
    )
      throw new Error("game requires exactly one winner for every pair of classes");
    const seen = new Set();
    const beats = input.beats.map((pair) => {
      if (
        !Array.isArray(pair) ||
        pair.length !== 2 ||
        pair[0] === pair[1] ||
        pair.some((x) => !classes.includes(x))
      )
        throw new Error("invalid game beats pair");
      const key = [...pair].sort().join("\u0000");
      if (seen.has(key)) throw new Error("duplicate or contradictory game beats pair");
      seen.add(key);
      return [...pair];
    });
    if (normalizedRules.length) throw new Error("choose game or label rules, not both");
    game = {
      beats,
      winText: text(input.winText ?? ""),
      lossText: text(input.lossText ?? ""),
      drawText: text(input.drawText ?? ""),
    };
  }
  return {
    id: item.id,
    type: "classifier",
    title: String(item.title || "카메라 이미지 분류"),
    wide: true,
    action: {
      skill: "image_classifier",
      model: "mobilenet",
      source,
      classes: [...classes],
      confidence,
      rules: normalizedRules,
      ...(game ? { game } : {}),
    },
  };
}

function visionDecision(config, label, confidence, opponent) {
  if (
    !config.classes.includes(label) ||
    !Number.isFinite(confidence) ||
    confidence < config.confidence
  )
    return { outcome: "uncertain", text: "" };
  if (!config.game)
    return { outcome: "classified", text: config.rules.find((r) => r.label === label)?.text || "" };
  if (!config.classes.includes(opponent)) throw new Error("Unknown opponent choice");
  if (label === opponent) return { outcome: "draw", text: config.game.drawText };
  const won = config.game.beats.some(([winner, loser]) => winner === label && loser === opponent);
  return { outcome: won ? "win" : "loss", text: won ? config.game.winText : config.game.lossText };
}

function normalizeCameraWidget(item) {
  if (item.action?.skill !== "camera_stream")
    throw new Error("camera_stream requires camera_stream action");
  const source = normalizeVisionSource(item.action.source);

  return {
    id: item.id,
    type: "camera_stream",
    title: String(item.title || "ESP32 카메라"),
    wide: true,
    action: { skill: "camera_stream", source },
  };
}

function renderVisionWidget(widget) {
  const esc = escapeHtml,
    config = widget.action;
  const previewOnly = widget.type === "camera_stream";
  const source = config.source || { type: "webcam" };
  const network = source.type === "esp32_stream";
  return `<article class="widget wide vision-widget" data-widget="${esc(widget.id)}">
    <h3>${esc(widget.title)}</h3>
    <label class="vision-source">카메라 입력 <select data-vision-source ${previewOnly ? "disabled" : ""}><option value="webcam" ${!network ? "selected" : ""}>PC 웹캠</option><option value="esp32_stream" ${network ? "selected" : ""}>ESP32 Wi-Fi 카메라</option></select></label>
    <label class="vision-url" ${network ? "" : "hidden"}>카메라 스트림 URL<input data-vision-url type="url" value="${esc(source.url || "")}" placeholder="http://카메라IP/stream"></label>
    ${previewOnly ? "" : `<p>1. 카메라 열기 → 2. 클래스별 샘플 수집 → 3. 학습 → 4. ${config.game ? "게임" : "분류"}</p>`}
    <div class="vision-layout${previewOnly ? " vision-preview-only" : ""}"><div>
      <video autoplay muted playsinline aria-label="PC 웹캠 미리보기" ${network ? "hidden" : ""}></video>
      <canvas data-esp32-preview width="640" height="480" aria-label="ESP32 카메라 미리보기" ${network ? "" : "hidden"}></canvas>
      <div class="vision-connection" role="status">연결 대기</div>
      <div class="vision-buttons"><button data-vision="start">카메라 열기</button><button data-vision="stop">카메라 끄기</button></div>
      <p class="vision-note">ESP32에는 이 브라우저가 직접 연결합니다.</p>
      ${previewOnly ? '<div class="vision-progress" role="status">카메라 주소를 입력하고 열어 주세요.</div>' : '<p class="vision-note">이미지와 학습은 이 브라우저에서 처리합니다. 클래스마다 다양한 장면으로 20장 이상 모아 주세요.</p>'}
    </div>${
      previewOnly
        ? ""
        : `<div><div class="vision-classes">${config.classes.map((label, i) => `<div><strong>${esc(label)}</strong><span data-count="${i}">0장</span><button data-vision="sample" data-class="${i}">5장 수집</button></div>`).join("")}</div>
      <div class="vision-buttons"><button data-vision="train">학습하기</button><button data-vision="reset">샘플 초기화</button></div>
      <div class="vision-progress" role="status">카메라를 열어 시작하세요.</div>
      <div class="vision-buttons"><button data-vision="predict">${config.game ? "게임하기" : "이미지 분류"}</button>${config.game ? "" : '<button data-vision="live">연속 분류 시작</button>'}</div>
      <div class="vision-result" aria-live="polite">학습 후 사용할 수 있습니다.</div>
      <div class="vision-score"></div><div class="vision-delivery" aria-live="polite"></div>
      <p class="vision-note">기준 신뢰도 ${Math.round(config.confidence * 100)}% · 학습한 분류기는 HTML 내보내기에 포함됩니다. AI 라이브러리와 기본 모델 다운로드에는 인터넷이 필요합니다.</p>
    </div>`
    }</div></article>`;
}

// This function and its two helpers are embedded in standalone HTML exports.
function createVisionRuntime(send, savedModels = {}) {
  const instances = new Map();
  let dependencies;
  async function script(src, name) {
    if (globalThis[name]) return;
    await new Promise((resolve, reject) => {
      const element = document.createElement("script");
      element.src = src;
      element.onload = resolve;
      element.onerror = () => {
        element.remove();
        reject(new Error("이미지 라이브러리 다운로드 실패. 인터넷 연결을 확인하세요."));
      };
      document.head.append(element);
    });
  }
  function load() {
    if (!dependencies)
      dependencies = (async () => {
        await script("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js", "tf");
        await script(
          "https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js",
          "mobilenet",
        );
        await globalThis.tf.ready();
      })().catch((error) => {
        dependencies = null;
        throw error;
      });
    return dependencies;
  }
  function mount(widget, node) {
    const config = widget.action;
    const previewOnly = widget.type === "camera_stream";
    const video = node.querySelector("video");
    const networkCanvas = node.querySelector("[data-esp32-preview]");
    const sourceSelect = node.querySelector("[data-vision-source]");
    const sourceURL = node.querySelector("[data-vision-url]");
    let sourceType = config.source?.type || "webcam";
    const status = node.querySelector(".vision-progress");
    const connection = node.querySelector(".vision-connection");
    const result = node.querySelector(".vision-result");
    const delivery = node.querySelector(".vision-delivery");
    const score = node.querySelector(".vision-score");
    const buttons = [...node.querySelectorAll("[data-vision]")];
    const samples = (config.classes || []).map(() => []);
    const scores = { win: 0, loss: 0, draw: 0 };
    let stream,
      backbone,
      head,
      busy = false,
      disposed = false,
      trained = false;
    let live = false,
      liveTimer;
    const network = createEsp32FrameSource(networkCanvas, (error, info = {}) => {
      if (disposed) return;
      networkCanvas.classList.toggle("is-stale", info.state !== "connected");
      if (info.state === "connected") {
        connection.textContent = `직접 연결 · ${info.width}×${info.height} · 수신 ${info.frames} 프레임`;
        if (info.resumed && !busy)
          status.textContent = previewOnly
            ? "ESP32 영상 연결 완료 · 자동 재연결됨"
            : "카메라 다시 연결됨 · 기존 학습은 유지됩니다.";
      } else if (info.state === "retrying") {
        connection.textContent = `연결 끊김 · ${info.delay / 1000}초 후 자동 재연결`;
      } else if (info.state === "connecting")
        connection.textContent = info.retry ? "카메라 다시 연결 중…" : "카메라 연결 중…";
      else if (info.state === "paused") connection.textContent = "다른 창으로 연결 전환됨";
      else if (info.state === "error")
        connection.textContent = "연결 실패 · 주소와 카메라 상태를 확인하세요";
      if (error) {
        stopLive();
        status.textContent = error.message;
      }
      controls();
    });
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    function controls() {
      const ready =
        sourceType === "esp32_stream" ? network.ready : !!stream && video.readyState >= 2;
      const connected = sourceType === "esp32_stream" ? network.active : !!stream;
      sourceSelect.disabled = previewOnly || busy || connected;
      sourceURL.disabled = busy || connected;
      buttons.forEach((button) => {
        const action = button.dataset.vision;
        button.disabled =
          disposed ||
          (busy && action !== "stop") ||
          (action === "start" && connected) ||
          (["sample", "predict", "live"].includes(action) && !ready) ||
          (["predict", "live"].includes(action) && !trained) ||
          (action === "train" && samples.some((items) => items.length < 5));
      });
      samples.forEach((items, i) => {
        node.querySelector(`[data-count="${i}"]`).textContent = `${items.length}장`;
      });
    }
    function stop() {
      stopLive();
      network.stop();
      connection.textContent = "카메라 꺼짐";
      networkCanvas.classList.remove("is-stale");
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      video.srcObject = null;
      controls();
    }
    function invalidate(clearSaved = true) {
      if (clearSaved) delete savedModels[widget.id];
      head?.dispose();
      head = null;
      trained = false;
    }
    function frame() {
      const remote = sourceType === "esp32_stream";
      if (remote ? !network.ready : !stream || video.readyState < 2 || !video.videoWidth)
        throw new Error("카메라를 열고 영상이 준비될 때까지 기다려 주세요.");
      const input = remote ? networkCanvas : video;
      const width = remote ? input.width : input.videoWidth;
      const height = remote ? input.height : input.videoHeight;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 224;
      const side = Math.min(width, height);
      canvas
        .getContext("2d")
        .drawImage(input, (width - side) / 2, (height - side) / 2, side, side, 0, 0, 224, 224);
      return backbone.infer(canvas, true);
    }
    async function start() {
      sourceType = sourceSelect.value;
      video.hidden = sourceType !== "webcam";
      networkCanvas.hidden = sourceType !== "esp32_stream";
      if (sourceType === "esp32_stream") {
        const source = normalizeVisionSource({ type: sourceType, url: sourceURL.value });
        if (!source.url) throw new Error("ESP32 카메라의 http://IP/stream 주소를 입력하세요.");
        sourceURL.value = source.url;
        status.textContent = "ESP32 영상에 직접 연결하는 중…";
        await network.start(source.url);
      } else {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error("PC 웹캠은 HTTPS 또는 localhost에서 사용할 수 있습니다.");
        const acquired = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: false,
        });
        if (disposed) {
          acquired.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = acquired;
        video.srcObject = stream;
        stream.getVideoTracks()[0].addEventListener("ended", stop, { once: true });
        await video.play();
        connection.textContent = "PC 웹캠 연결됨";
      }
      if (disposed) return;
      if (previewOnly) {
        status.textContent =
          sourceType === "esp32_stream" ? "ESP32 영상 연결 완료" : "PC 웹캠 연결 완료";
        return;
      }
      status.textContent = "이미지 모델을 준비하는 중…";
      await load();
      if (disposed) return;
      if (!backbone) {
        const loaded = await globalThis.mobilenet.load({ version: 2, alpha: 0.5 });
        if (disposed) {
          loaded.model.dispose();
          return;
        }
        backbone = loaded;
      }
      // 분류기 가중치는 내보낸 HTML에 포함됩니다. MobileNet은 동일한 버전을 사용합니다.
      const saved = savedModels[widget.id];
      if (!trained && saved) {
        if (
          saved.version !== 1 ||
          saved.model !== "mobilenet-v2-0.5" ||
          JSON.stringify(saved.classes) !== JSON.stringify(config.classes)
        )
          throw new Error(
            "저장된 분류기와 클래스 설정이 일치하지 않습니다. 초기화 후 다시 학습하세요.",
          );
        const bytes = Uint8Array.from(atob(saved.weightData), (c) => c.charCodeAt(0));
        const restored = await globalThis.tf.loadLayersModel(
          globalThis.tf.io.fromMemory({
            modelTopology: saved.modelTopology,
            weightSpecs: saved.weightSpecs,
            weightData: bytes.buffer,
          }),
        );
        const embedding = frame();
        const valid =
          restored.inputs[0].shape[1] === embedding.shape[1] &&
          restored.outputs[0].shape[1] === config.classes.length;
        embedding.dispose();
        if (disposed || !valid) {
          restored.dispose();
          if (!valid) throw new Error("저장된 분류기의 입출력 크기가 맞지 않습니다.");
          return;
        }
        head = restored;
        trained = true;
      }
      status.textContent = trained
        ? "저장된 분류기 준비 완료 · 바로 분류할 수 있습니다."
        : "카메라 준비 완료 · 샘플을 수집하세요.";
    }
    function stopLive() {
      live = false;
      clearTimeout(liveTimer);
      const button = node.querySelector('[data-vision="live"]');
      if (button) button.textContent = "연속 분류 시작";
    }
    function liveStep() {
      if (!live || disposed) return;
      if (busy) {
        liveTimer = setTimeout(liveStep, 500);
        return;
      }
      busy = true;
      controls();
      predict()
        .catch((error) => {
          stopLive();
          status.textContent = error.message;
        })
        .finally(() => {
          busy = false;
          if (disposed) release();
          else controls();
          if (live) liveTimer = setTimeout(liveStep, 500);
        });
    }
    async function capture(index) {
      if (samples[index].length >= 200)
        throw new Error("클래스마다 최대 200장까지 수집할 수 있습니다.");
      stopLive();
      invalidate();
      for (let i = 0; i < 5 && samples[index].length < 200; i++) {
        if (disposed) return;
        samples[index].push(frame());
        controls();
        status.textContent = `${config.classes[index]} 샘플 수집 중…`;
        await pause(180);
      }
      status.textContent =
        "샘플 수집 완료 · 각 클래스 5장 이상이면 학습할 수 있습니다. 20장 이상을 권장합니다.";
    }
    async function train() {
      if (samples.some((items) => items.length < 5))
        throw new Error("각 클래스에 최소 5장의 샘플이 필요합니다.");
      const tf = globalThis.tf;
      stopLive();
      invalidate();
      let xs, ys;
      try {
        xs = tf.concat(samples.flat());
        ys = tf.tidy(() =>
          tf.oneHot(
            tf.tensor1d(
              samples.flatMap((items, i) => items.map(() => i)),
              "int32",
            ),
            config.classes.length,
          ),
        );
        head = tf.sequential();
        head.add(tf.layers.dense({ inputShape: [xs.shape[1]], units: 64, activation: "relu" }));
        head.add(tf.layers.dense({ units: config.classes.length, activation: "softmax" }));
        head.compile({ optimizer: "adam", loss: "categoricalCrossentropy", metrics: ["accuracy"] });
        await head.fit(xs, ys, {
          epochs: 30,
          batchSize: Math.min(16, xs.shape[0]),
          shuffle: true,
          callbacks: {
            onEpochEnd: async (epoch, logs) => {
              if (disposed) head.stopTraining = true;
              else status.textContent = `학습 ${epoch + 1}/30 · 학습 손실 ${logs.loss.toFixed(3)}`;
              await tf.nextFrame();
            },
          },
        });
        if (!disposed) {
          trained = true;
          status.textContent = "학습 완료 · 새로운 장면으로 인식을 확인하세요.";
        }
      } catch (error) {
        invalidate();
        throw error;
      } finally {
        xs?.dispose();
        ys?.dispose();
      }
    }
    async function predict() {
      if (!trained) throw new Error("샘플을 수집하고 먼저 학습하세요.");
      // Commit the PC choice before capturing the user's hand.
      let opponent;
      if (config.game) {
        const random = new Uint32Array(1);
        crypto.getRandomValues(random);
        opponent = config.classes[Math.floor((random[0] / 4294967296) * config.classes.length)];
      }
      const probabilities = globalThis.tf.tidy(() => {
        const embedding = frame();
        return Array.from(head.predict(embedding).dataSync());
      });
      let index = 0;
      probabilities.forEach((value, i) => {
        if (value > probabilities[index]) index = i;
      });
      const label = config.classes[index],
        confidence = probabilities[index];
      const decision = visionDecision(config, label, confidence, opponent);
      delivery.textContent = "";
      if (decision.outcome === "uncertain") {
        result.textContent = `인식이 불확실합니다 (${Math.round(confidence * 100)}%). 샘플을 더 모으거나 다시 시도하세요.`;
        return;
      }
      const names = { win: "사용자 승리", loss: "PC 승리", draw: "무승부" };
      result.textContent = `인식: ${label} (${Math.round(confidence * 100)}%)${config.game ? ` · PC: ${opponent} · ${names[decision.outcome]}` : ""}`;
      if (config.game) {
        scores[decision.outcome]++;
        score.textContent = `사용자 ${scores.win} : PC ${scores.loss} · 무승부 ${scores.draw}`;
      }
      if (decision.text) {
        delivery.textContent = `ESP32에 ${decision.text} 전송 중…`;
        const sent = await send(decision.text, true);
        if (!disposed)
          delivery.textContent = sent
            ? `ESP32 명령 전송 요청 완료: ${decision.text}`
            : `전송 실패: ${decision.text} · 브릿지와 ESP32 연결을 확인하세요.`;
      }
    }
    async function click(event) {
      const button = event.target.closest("[data-vision]");
      if (!button || !node.contains(button)) return;
      const action = button.dataset.vision;
      if (action === "stop") {
        stop();
        status.textContent = "카메라를 껐습니다.";
        return;
      }
      if (action === "live" && live) {
        stopLive();
        return;
      }
      if (busy || disposed) return;
      if (action === "live") {
        live = true;
        button.textContent = "연속 분류 중지";
        liveStep();
        return;
      }
      busy = true;
      controls();
      try {
        if (action === "start") await start();
        if (action === "sample") await capture(Number(button.dataset.class));
        if (action === "train") await train();
        if (action === "predict") await predict();
        if (action === "reset") {
          stopLive();
          invalidate();
          samples.forEach((items) => {
            items.forEach((tensor) => tensor.dispose());
            items.length = 0;
          });
          scores.win = scores.loss = scores.draw = 0;
          score.textContent = "";
          delivery.textContent = "";
          result.textContent = "학습 후 사용할 수 있습니다.";
          status.textContent = "샘플을 초기화했습니다.";
        }
      } catch (error) {
        if (action === "start") stop();
        if (!disposed)
          status.textContent =
            error.name === "NotAllowedError"
              ? "카메라 권한이 거부되었습니다. 브라우저 설정에서 허용해 주세요."
              : error.message;
      } finally {
        busy = false;
        if (disposed) release();
        else controls();
      }
    }
    function release() {
      invalidate(false);
      backbone?.model.dispose();
      backbone = null;
      samples.forEach((items) => {
        items.forEach((tensor) => tensor.dispose());
        items.length = 0;
      });
    }
    function sourceChange() {
      stop();
      invalidate();
      samples.forEach((items) => {
        items.forEach((tensor) => tensor.dispose());
        items.length = 0;
      });
      sourceType = sourceSelect.value;
      node.querySelector(".vision-url").hidden = sourceType !== "esp32_stream";
      video.hidden = sourceType !== "webcam";
      networkCanvas.hidden = sourceType !== "esp32_stream";
      try {
        config.source = normalizeVisionSource({ type: sourceType, url: sourceURL.value });
      } catch (error) {
        status.textContent = error.message;
        controls();
        return;
      }
      if (result) result.textContent = "학습 후 사용할 수 있습니다.";
      if (delivery) delivery.textContent = "";
      if (score) score.textContent = "";
      scores.win = scores.loss = scores.draw = 0;
      status.textContent = "입력이 변경되었습니다. 카메라를 다시 열어 주세요.";
      controls();
    }
    sourceSelect.addEventListener("change", sourceChange);
    sourceURL.addEventListener("change", sourceChange);
    node.addEventListener("click", click);
    controls();
    return {
      node,
      async serialize() {
        if (previewOnly) return undefined;
        if (busy) throw new Error("샘플 수집·학습·분류가 끝난 뒤 다시 내보내세요.");
        if (!trained) return savedModels[widget.id];
        // export 중 초기화나 재학습으로 가중치가 변경되지 않도록 잠급니다.
        busy = true;
        controls();
        let bundle;
        try {
          await head.save(
            globalThis.tf.io.withSaveHandler(async (artifacts) => {
              const bytes = new Uint8Array(artifacts.weightData);
              let binary = "";
              for (let i = 0; i < bytes.length; i += 8192)
                binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
              bundle = {
                version: 1,
                model: "mobilenet-v2-0.5",
                classes: [...config.classes],
                modelTopology: artifacts.modelTopology,
                weightSpecs: artifacts.weightSpecs,
                weightData: btoa(binary),
              };
              return {
                modelArtifactsInfo: {
                  dateSaved: new Date(),
                  modelTopologyType: "JSON",
                  modelTopologyBytes: JSON.stringify(artifacts.modelTopology).length,
                  weightSpecsBytes: JSON.stringify(artifacts.weightSpecs).length,
                  weightDataBytes: bytes.byteLength,
                },
              };
            }),
          );
          return bundle;
        } finally {
          busy = false;
          if (disposed) release();
          else controls();
        }
      },
      get signature() {
        return JSON.stringify(widget);
      },
      dispose() {
        disposed = true;
        stop();
        node.removeEventListener("click", click);
        sourceSelect.removeEventListener("change", sourceChange);
        sourceURL.removeEventListener("change", sourceChange);
        if (!busy) release();
      },
    };
  }
  return {
    async exportModels() {
      const models = {};
      for (const [id, instance] of instances) {
        const bundle = await instance.serialize();
        if (bundle) models[id] = bundle;
      }
      return models;
    },
    render(grid, widgets) {
      const classifiers = widgets.filter((widget) =>
        ["classifier", "camera_stream"].includes(widget.type),
      );
      if (classifiers.length && !document.querySelector("style[data-vision-style]")) {
        const style = document.createElement("style");
        style.dataset.visionStyle = "";
        style.textContent = visionStyles();
        document.head.append(style);
      }
      for (const [id, instance] of instances) {
        const next = classifiers.find((widget) => widget.id === id);
        if (!next || JSON.stringify(next) !== instance.signature) {
          instance.dispose();
          instances.delete(id);
        }
      }
      // Detach/reinsert retained classifier nodes so sensor polling never loses samples or camera streams.
      for (const instance of instances.values()) instance.node.remove();
      grid.innerHTML = widgets.map(renderWidget).join("");
      for (const widget of classifiers) {
        const placeholder = grid.querySelector(`[data-widget="${widget.id}"]`);
        const retained = instances.get(widget.id);
        if (retained) placeholder.replaceWith(retained.node);
        else instances.set(widget.id, mount(widget, placeholder));
      }
    },
    dispose() {
      for (const instance of instances.values()) instance.dispose();
      instances.clear();
    },
  };
}

function visionStyles() {
  return `
.vision-widget{grid-column:1/-1;color:#243746;background:white;border:1px solid #c7d9ef;border-radius:12px;padding:20px}
.vision-widget h3{margin:0 0 8px;font-size:20px}.vision-widget p{font-size:13px;line-height:1.7;margin:8px 0 16px}
.vision-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}.vision-layout>div{min-width:0}
.vision-widget video,.vision-widget canvas{width:100%;aspect-ratio:1;object-fit:cover;background:#edf3f8;border:2px dashed #b8cce6;border-radius:10px}
.vision-connection{font-size:12px;color:#156b5c;margin:8px 0;min-height:20px}.vision-widget canvas.is-stale{opacity:.45}
.vision-widget video{transform:scaleX(-1)}
.vision-widget [hidden]{display:none!important}.vision-source,.vision-url{display:block;font-size:13px;margin:8px 0}.vision-source select,.vision-url input{box-sizing:border-box;max-width:100%;width:100%;padding:8px;border:1px solid #b8cce6;border-radius:6px}.vision-preview-only{grid-template-columns:1fr}
.vision-buttons{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.vision-widget button{background:#eaf2fc;color:#24558d;border:1px solid #c7d9ef;border-radius:7px;padding:9px 12px;font:600 13px system-ui;cursor:pointer}
.vision-widget button[data-vision="train"],.vision-widget button[data-vision="predict"]{background:#087f8c;color:white;border-color:#087f8c}
.vision-widget button:disabled{background:#edf1f5;color:#788895;border-color:#dde5ed;cursor:default}.vision-widget button:focus-visible{outline:3px solid #2463ad;outline-offset:2px}
.vision-classes{display:grid;gap:8px}.vision-classes>div{display:flex;align-items:center;gap:8px;border:1px solid #d7e0e8;background:#f6f9fc;border-radius:8px;padding:8px;flex-wrap:wrap}
.vision-classes strong{flex:1;overflow-wrap:anywhere;font-size:14px}.vision-classes span{font-size:12px;color:#526777}.vision-classes button{font-size:12px;padding:7px}
.vision-progress{font-size:13px;line-height:1.6;color:#526777;min-height:42px}.vision-result{padding:12px;background:#e5f4ed;border-radius:8px;font-size:14px;line-height:1.7}.vision-score{font-weight:700;font-size:14px;margin-top:12px}.vision-delivery{font-size:13px;margin-top:8px;line-height:1.6;overflow-wrap:anywhere}.vision-widget .vision-note{font-size:12px;color:#5e7180}
@media(max-width:1150px){.vision-layout{grid-template-columns:1fr}.vision-widget video,.vision-widget canvas{max-height:320px}}`;
}
