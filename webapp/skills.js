/**
 * PhyVibe의 스킬 카탈로그와 공통 명령 전송 함수.
 *
 * skills: 장치에 명령을 보내거나 센서 값을 표시하는 기능.
 * browserSkills: 카메라 입력과 브라우저 안에서 수행하는 이미지 학습·분류.
 * profiles: 선택한 장치에서 컴파일러가 허용할 스킬의 범위.
 *
 * 이 카탈로그는 실행 스킬 계약입니다. LLM의 의도 계약과 빌더는 intent.js에 있습니다.
 * 변경 시 인자 검증·의도 컴파일·독립 HTML 실행을 함께 확인합니다.
 */
// Supported generation skills and device capabilities.
const SKILL_CATALOG = Object.freeze({
  version: 1,
  // 장치 스킬: app.js가 인자를 검증하고 최종 명령 문자열을 만듭니다.
  skills: {
    // 브릿지로 들어온 센서 키를 화면 값에 연결합니다.
    display_sensor: {
      description: "Display incoming DATA:key:value or sensor JSON",
      arguments: { key: "sensor key" },
    },
    // 사용자가 지정한 문자열은 대소문자와 공백을 포함해 그대로 전송합니다.
    send_text: {
      description: "Send exact literal text to ESP32; custom firmware must handle it for a physical effect",
      arguments: { text: "1–256 single-line characters; preserve case/spaces" },
    },
    // 서보 각도는 0~180 범위로 제한합니다.
    set_servo: {
      description: "Slider sends CMD:target:angle to the ESP32 controller",
      arguments: { target: "servo, valve, or mouth", range: "integer 0..180" },
    },
    // 방향 제어: forward/backward/left/right/stop과 속도를 함께 표현합니다.
    drive_motor: {
      description:
        "Directional robot button; runtime sends CMD:motor:<direction>:<speed>. Use for forward/backward/left/right/stop, never plain set_motor for steering.",
      arguments: {
        direction: "forward | backward | left | right | stop",
        speed: "integer 0..80; stop uses 0",
        speedFrom:
          "exact id of an included control widget with action set_motor; use instead of fixed speed for a shared slider",
      },
    },
    // 속도 제어: speedFrom은 같은 계획 안의 모터 슬라이더 ID입니다.
    set_motor: {
      description:
        "Motor slider or button. Runtime builds CMD:motor:<speed>; stop is CMD:motor:0. Never invent action/stop text commands.",
      arguments: {
        speed: "fixed button: integer 0..80; 0 stops the motor",
        speedFrom:
          "exact id of an included control widget with action set_motor; uses its current speed on click",
        range: "slider: integer 0..80",
      },
    },
  },
  // 브라우저 스킬: ESP32 영상도 PC 중계 없이 직접 입력받습니다.
  browserSkills: {
    // 영상 표시만 필요한 경우의 스킬입니다. CNN 학습은 수행하지 않습니다.
    camera_stream: {
      widgetType: "camera_stream",
      description:
        "Camera widget with built-in streaming start button, stop button and video display. Use ONE widget {type:camera_stream,action:{skill:camera_stream,source:{type:esp32_stream,url:...}}}; do not create separate camera button widgets or device commands. Can also combine with requested motor controls.",
      arguments: {
        source:
          "{type:esp32_stream,url:http://CAMERA_IP/stream}; use configured camera URL, never invent an IP",
      },
    },
    // 학습에 사용할 클래스별 이미지 샘플을 수집합니다.
    camera_capture: {
      internal: true,
      description:
        "Capture labeled images locally from PC webcam or a direct ESP32 MJPEG source; no image upload",
    },
    // 고정된 CNN 특징 추출기 위에 사용자 클래스 분류기를 학습합니다.
    train_classifier: {
      internal: true,
      description:
        "Train a dense classification head on frozen MobileNet CNN embeddings in the browser",
    },
    // 현재 프레임을 분류하고 신뢰도가 기준을 넘는지 판단합니다.
    classify_image: {
      internal: true,
      description:
        "Predict a trained class from a webcam or ESP32 frame with a confidence threshold",
    },
    // 분류 결과를 사용자 규칙 또는 게임 결과와 연결합니다.
    evaluate_rules: {
      internal: true,
      description:
        "Match a predicted label or compare it against a random opponent using configured beats pairs; send exact text via existing send_text",
    },
    // 카메라·샘플·학습·분류·결과 규칙을 묶은 위젯 스킬입니다.
    image_classifier: {
      widgetType: "classifier",
      description:
        "Reusable classifier widget combining camera_capture, train_classifier, classify_image and evaluate_rules",
      arguments: {
        source:
          "{type:webcam} (default), or {type:esp32_stream,url:http://CAMERA_IP/stream}; browser decodes frames directly, CNN remains in browser",
        classes: "2–8 unique labels",
        confidence: "0.5–0.99, default 0.8",
        model: "mobilenet only; trained classifier weights can be included in exported HTML",
        rules:
          "optional label rules: send_text{text}, set_motor{speed}, drive_motor{direction,speed}, set_servo{target,angle}; use only profile skills and fixed values",
        game: "optional {beats:[[winner,loser]],winText,lossText,drawText}; one direction for every pair; choose rules OR game",
      },
    },
  },
  // 프로필은 의도 컴파일러가 사용할 수 있는 장치 스킬을 제한합니다.
  profiles: {
    esp32: {
      label: "ESP32",
      skills: ["display_sensor", "send_text", "set_servo", "set_motor", "drive_motor"],
      description:
        "ESP32 handles motor and servo commands directly; text commands and sensor keys need custom firmware handlers.",
    },
  },
});

// Studio와 독립 HTML 웹앱이 함께 사용하는 HTTP 명령 전송 함수입니다.
// signal은 연결 중지 시 요청을 취소하고, timeout은 응답 대기를 제한합니다.
// 성공은 ESP32 전송 큐잉을 뜻하며 실제 동작 완료를 확인하지 않습니다.
async function deliverCommand(network, command, report, signal) {
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
    : AbortSignal.timeout(5000);
  const response = await fetch(`${network.bridgeUrl}/api/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command }),
    signal: requestSignal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  report(`TX ${command} · ESP32 ${result.sent_count} · execution unconfirmed`);
  return true;
}
