# PHYVIBE Studio Webapp

자연어 입력, 생성 결과 미리보기, 네트워크 연결과 Wi-Fi 데이터 모니터를 중심으로 구성한 브라우저 MVP입니다.

## 빠른 실행

프로토타입은 별도 AI 서버 없이 내장 데모 엔진으로 바로 실행할 수 있습니다. 실제 로컬 LLM 생성을 시험하려면 별도 터미널에서 Qwen3 8B를 `8080` 포트로 실행합니다.

```bash
llama-server -m /path/to/Qwen3-8B.gguf --host 127.0.0.1 --port 8080 --alias qwen3-8b -c 8192
```

그다음 저장소 루트에서 웹 서버를 실행하고 `http://localhost:3000/webapp/`에 접속합니다.

```bash
python3 -m http.server 3000
```

이 웹앱은 사용자 네트워크 웹앱을 생성하는 저작 스튜디오입니다. micro:bit는 MakeCode에서 별도로 프로그래밍하고, ESP32는 Wi-Fi 브릿지로 사용합니다. PC와 사용자 웹앱은 Wi-Fi 또는 Ethernet으로 서버에 접속합니다.

## 구현 기능

- 자연어 프롬프트를 통한 JSON 위젯 생성
- API 키 없이 자연어 입력으로 시험할 수 있는 내장 데모 엔진
- 라이브 뷰, 생성 코드, JSON 스키마 탭
- 데스크톱/태블릿/모바일 뷰포트 미리보기
- 설정 가능한 HTTP/HTTPS 브릿지 URL과 1초 간격 네트워크 센서 데이터 조회
- 네트워크 명령 전송: 서버 → ESP32 Wi-Fi 브릿지 → micro:bit 컨트롤러
- 서보 0~180도, 모터 PWM -255~255 안전 클램핑
- 기획서 규격의 `DATA:<key>:<value>`, `CMD:*`, `MOT:L:R`, `WIFI:*` 텍스트 패킷 처리
- 실제 네트워크 RX/TX 모니터와 수동 명령 전송 (가상 센서 패킷 없음)
- OpenAI/Gemini BYOK 로컬 저장 및 API 연결 테스트
- 독립 실행 HTML 사용자 웹앱 내보내기 (네트워크 연결, 센서 위젯, 제어, 데이터 모니터 포함)
- 스키마 탭에서 네트워크 설정 및 위젯 JSON 복사

## 로컬 Qwen3 8B

앱은 시작 시 llama.cpp의 `http://localhost:8080/v1/models`에서 로드된 Qwen 모델을 자동으로 찾습니다. 연결될 때까지 시작 화면에서 3초 간격으로 재시도합니다. LLM 서버는 `8080`, HTTP 브릿지는 `5000`, ESP32 명령 TCP 연결은 `5001`을 사용합니다.

```bash
llama-server -m /path/to/Qwen3-8B.gguf --host 127.0.0.1 --port 8080
```

위젯 생성은 로컬 llama.cpp의 OpenAI 호환 `/v1/chat/completions`를 사용합니다. `/v1/models`에서 실제 모델 ID를 읽기 때문에 GGUF 파일명과 모델 ID가 달라도 동작합니다. 기존 OpenAI와 Gemini 설정 및 연결 테스트도 그대로 유지됩니다.

llama.cpp 설치, GGUF 검색, CPU/GPU 옵션, Windows 명령 및 문제 해결은 저장소 최상위 `README.md`를 참고하세요.

## 네트워크 연결 및 사용자 웹앱 실행

1. 저장소 루트에서 `npm run build:bridge` 후 `./bridge-server/build/phyvibe-bridge`를 실행하고 **Start server**를 누릅니다. 독립 C++ 서버는 Studio와 고객 웹앱이 함께 사용합니다.
2. ESP32에 서버 PC의 IP를 설정하고 micro:bit MakeCode 프로그램으로 연결합니다. Wi-Fi 설정은 보드 측에서 수행합니다.
3. 스튜디오의 **브릿지 서버 URL**에 `http://서버_PC_IP:5000`을 입력하고 연결 토글을 켭니다. 같은 PC에서는 `http://localhost:5000`을 사용할 수 있습니다.
4. Local Qwen을 선택하고 **웹 UI** 생성 요청을 입력합니다. 센서 ID는 micro:bit가 보내는 `DATA:<key>:<value>`의 key와 일치해야 합니다.
5. **웹앱 내보내기**로 `phyvibe-webapp.html`을 저장합니다. 내보낸 웹앱은 Studio나 LLM 없이 실행됩니다. 웹 서버에서 제공하고 브릿지 URL을 확인한 뒤 연결하세요.

HTTPS 페이지에서는 HTTPS 브릿지를 사용하세요. 다른 PC나 모바일에서 `localhost`는 그 장치 자신을 가리키므로 서버 PC의 네트워크 주소를 사용합니다.

서버 연결 상태와 ESP32 연결 수는 별도로 표시됩니다. 서버에 연결되었더라도 ESP32 명령 TCP 연결이 없으면 명령은 실패합니다. 전송 성공 표시는 ESP32 연결에 전송이 큐잉되었다는 뜻입니다.

Wi-Fi 모니터는 서버가 수신한 데이터와 서버로 전송한 명령만 표시합니다. UART 디버그, USB 연결, 장치 페어링은 스튜디오에서 제공하지 않습니다. micro:bit MakeCode 링크는 외부 편집기를 엽니다.

Local Qwen이 기본 생성 공급자입니다. 이전 버전의 기본 데모 설정은 한 번 Local Qwen으로 전환됩니다. 이후 명시적으로 선택한 데모 모드는 유지되며 LLM 요청이 없다는 표시가 나타납니다. OpenAI/Gemini 연결 테스트와 달리 해당 공급자의 웹앱 생성은 아직 구현되지 않았으며 생성 시 오류를 표시합니다.

LLM 기본 URL은 `http://127.0.0.1:8080`입니다. 다른 포트는 AI 설정 또는 연결 대기창의 URL에서 변경할 수 있습니다. 데모 모드에서도 프롬프트 위의 **Local LLM 연결 ↻** 버튼으로 즉시 Local Qwen으로 돌아갑니다. 서버 연결 실패는 자동으로 데모 모드를 선택하지 않습니다. 브라우저가 다른 PC에서 실행되면 LLM 서버의 접근 가능한 네트워크 주소를 사용해야 합니다.


## 생성 하네스

Local Qwen은 실행 코드를 직접 작성하는 대신 지원하는 스킬로 JSON 계획을 생성합니다. Studio가 계획을 검증하고 위젯과 네트워크 동작으로 변환합니다.

| 스킬 | 용도 | 예시 |
|---|---|---|
| `display_sensor` | 센서 키에 연결한 metric/gauge/chart/alert | `{"skill":"display_sensor","key":"temperature"}` |
| `send_text` | 버튼 클릭 시 문자열 그대로 전송 | `{"skill":"send_text","text":"a"}` |
| `set_servo` | micro:bit 서보 제어 슬라이더, 0–180도 | `{"skill":"set_servo","target":"servo"}` |
| `set_motor` | micro:bit 모터 제어 슬라이더, 0–80% | `{"skill":"set_motor"}` |

버튼은 `actions` 배열에 `send_text` 스킬을 지정하고 순서대로 실행합니다. 다른 위젯은 `action`을 지정합니다. 문자열에는 접두사나 숫자를 추가하지 않습니다. 네트워크 전송 실패 시 남은 버튼 동작은 중지합니다. 전송 성공은 서버→ESP32 전송 큐잉을 뜻합니다.

예시 요청: **버튼을 누르면 소문자 a 한 글자를 보내는 웹앱을 만들어줘.**

```json
{"title":"문자 전송","widgets":[{"id":"send-a","type":"button","title":"a 전송","actions":[{"skill":"send_text","text":"a"}]}]}
```

지원하지 않는 스킬, 누락된 동작, 중복 ID 및 잘못된 제어 범위는 거절합니다. JSON 계획이 잘못되면 LLM에 검증 오류를 전달해 한 번 수정 요청하고, 다시 실패하면 생성 오류를 표시합니다. 지원 스킬은 스키마 탭에서도 확인할 수 있습니다. 이 검증은 계획의 구조를 검사하며 모든 자연어 요구사항의 의미 일치를 보장하지는 않습니다.

기존 다운로드 파일은 자동으로 갱신되지 않습니다. Studio를 새로고침하고 생성 후 웹앱을 다시 내보내세요.

검증 명령 (저장소 루트):

```bash
node tests/test_generation_harness.cjs
node tests/test_local_llm.cjs
node tests/test_studio_export.cjs
npm run test:bridge
```

Electron Studio도 C++ 브릿지를 포함하거나 자동 실행하지 않습니다. 브릿지는 별도로 실행하며 Studio를 닫아도 계속 실행됩니다.

## 카메라 분류 스킬과 가위바위보

Qwen3는 JSON 앱 구성을 생성하고, 이미지 인식은 브라우저의 TensorFlow.js가 실행합니다. Qwen3에 이미지 입력을 보내거나 별도 비전 LLM을 실행할 필요가 없습니다. 고정된 MobileNet V2 CNN에서 이미지 특징을 추출하고, 사용자가 수집한 클래스별 샘플로 작은 신경망 분류기를 학습합니다.

재사용 가능한 브라우저 스킬은 `camera_capture`, `train_classifier`, `classify_image`, `evaluate_rules`입니다. Qwen은 이 흐름을 `image_classifier` 액션의 `classifier` 위젯으로 구성합니다. 클래스 이름, 신뢰도 기준, 클래스별 전송 규칙 또는 PC와 비교하는 승패 관계는 JSON 설정입니다. 새 클래스나 같은 방식의 게임마다 새 스킬을 작성할 필요가 없습니다. 클래스 규칙은 장치 프로필에서 허용한 `send_text`, `set_motor`, `drive_motor`, `set_servo`를 사용할 수 있습니다. 모터 속도(0–80), 방향, 서보 각도(0–180)는 검증된 고정값이며 명령 문자열은 JavaScript가 만듭니다. 임의 JavaScript와 `speedFrom` 규칙은 지원하지 않습니다.

1. 자신의 MakeCode 프로그램에 맞는 문자열 명령을 사용합니다.
2. 다음 프롬프트를 입력합니다:

   > 웹 카메라로 rock, paper, scissors 가위바위보 게임을 만들어줘. 클래스별 샘플을 모아 CNN 전이학습을 하고 PC와 게임해. 사용자가 이기면 micro:bit에 대문자 O, 지면 소문자 x를 보내고 무승부에는 보내지 마.

3. 생성된 앱에서 **카메라 열기**를 누르고 카메라 권한을 허용합니다. 영상 중앙에 손을 놓고 클래스별 **5장 수집**을 반복합니다. 클래스마다 최소 5장, 권장 20장 이상을 다양한 각도·거리·배경에서 수집합니다.
4. **학습하기**를 누릅니다. 학습 손실 표시는 학습 샘플에 대한 값이며, 새로운 손동작의 인식 정확도를 보장하지 않습니다. 새로운 샘플로 결과를 확인하고 필요하면 샘플을 추가한 뒤 재학습합니다.
5. 브릿지를 연결하고 게임 버튼을 누릅니다. PC 선택은 손동작 추론 전에 무작위로 결정합니다. 신뢰도가 기준보다 낮으면 결과·점수를 확정하지 않고 명령도 보내지 않습니다. 사용자가 이기면 `O`, 지면 `x` 한 글자를 그대로 보냅니다. 무승부에는 기본적으로 전송하지 않습니다.
6. MakeCode에서는 전달받은 `O`와 `x`를 표시하도록 직접 구현합니다. Legacy 전송 성공은 ESP32 연결에 큐잉되었다는 뜻이며, micro:bit 표시 완료 확인은 아닙니다.

웹 카메라는 HTTPS 또는 localhost에서 사용하세요. 내보낸 HTML에도 카메라·학습·게임 런타임이 포함되며, Studio와 Qwen 없이 실행할 수 있습니다. 학습 후 **웹앱 내보내기**를 누르면 학습한 분류기 가중치와 클래스 설정이 HTML에 포함됩니다. 내보낸 HTML은 카메라를 열면 분류기를 복원하여 샘플 수집·재학습 없이 분류할 수 있습니다. 원본 샘플 이미지는 저장하지 않습니다. 에디터 자체를 새로고침하기 전에는 내보내기를 완료하세요. 화면의 미리보기 새로고침이나 센서 갱신은 학습 상태를 유지합니다. 클래스 변경 또는 새 위젯 생성 시 해당 학습 상태는 초기화됩니다.

TensorFlow.js 4.22.0과 MobileNet 2.1.1 라이브러리 및 사전 학습된 모델은 필요할 때 다운로드합니다. 최초 실행에는 인터넷 접근이 필요합니다. 카메라 이미지와 수집한 특징은 서버나 Qwen에 업로드하지 않습니다. `카메라 끄기`, 위젯 제거, 페이지 종료 시 카메라 스트림을 정리합니다.

사용자 정의 분류 예시 (`rules`와 `game` 중 하나를 사용):

```json
{
  "id": "gesture",
  "type": "classifier",
  "title": "손동작 분류",
  "action": {
    "skill": "image_classifier",
    "classes": ["open", "closed"],
    "confidence": 0.8,
    "rules": [{"label": "open", "skill": "send_text", "text": "a"}]
  }
}
```

`game.beats`는 `[이기는 클래스, 지는 클래스]` 쌍으로 모든 서로 다른 클래스 조합의 승자를 한 번씩 정의합니다. 같은 클래스는 무승부입니다. `winText`, `lossText`, `drawText`가 빈 문자열이면 해당 결과에서 명령을 보내지 않습니다. 생성기는 중복 클래스·모순된 승패 관계·잘못된 신뢰도·장치 프로필에서 허용하지 않는 명령을 거절합니다.

구현 참고: [TensorFlow.js 전이학습](https://www.tensorflow.org/js/tutorials/transfer/image_classification), [MobileNet 이미지 특징 API](https://github.com/tensorflow/tfjs-models/tree/master/mobilenet).

검증: `npm test`는 생성 계획·승패 9가지·신뢰도·프로필 제한·내보내기를 검사합니다. `npm run test:vision:browser`는 Chrome에서 합성 카메라 영상으로 실제 MobileNet 특징 추출과 분류기 학습·추론, O/x 전송, 상태 유지와 리소스 정리, 독립 HTML 실행을 검사합니다. 브라우저 테스트에는 Chrome, Node 22 이상(프로젝트 로컬 런타임이 있으면 자동 사용), 모델 다운로드용 인터넷 접근이 필요합니다. Chrome 경로는 `CHROME_BIN`으로 변경할 수 있습니다. 실제 손동작 정확도와 micro:bit 표시 동작은 사용자 샘플 및 실제 하드웨어로 별도 확인해야 합니다.


## ESP32 Wi-Fi 카메라와 브라우저 CNN

ESP32 카메라 영상은 에디터 또는 내보낸 웹앱의 브라우저가 **직접** 읽습니다. PC 영상 중계 서버를 사용하지 않으며 Python 수신기를 실행할 필요가 없습니다.

1. `camera/lilygo_camera_station/lilygo_camera_station.ino`를 다시 업로드합니다. 브라우저가 프레임을 읽기 위한 CORS와 OPTIONS 응답이 추가되어 있어 기존 펌웨어는 업데이트해야 합니다.
2. 에디터 오른쪽 **ESP32 카메라 실시간 영상**에서 `http://카메라IP/stream`을 입력합니다. **카메라 열기**로 미리보기를 확인합니다. 같은 에디터에서 생성 위젯을 열면 연결을 해당 위젯으로 넘깁니다.
3. 예: **ESP32 카메라 영상으로 물체 있음/없음을 CNN으로 분류하는 웹앱을 만들어 주세요.** “이 카메라와 CNN으로…”처럼 요청해도 저장한 ESP32 주소를 생성 설정에 사용합니다. PC 웹캠을 명시하면 웹캠을 선택합니다. 프롬프트에서 URL을 직접 지정할 수도 있습니다.
4. 생성된 분류 위젯에서 **카메라 열기 → 클래스별 5장 이상 수집 (20장 이상 권장) → 학습하기 → 이미지 분류 또는 연속 분류 시작**을 사용합니다. 클래스별 실제로 다른 장면을 수집해야 합니다.
5. 웹앱을 내보내면 카메라 입력과 URL도 포함됩니다. 학습을 마친 뒤 내보내면 분류기 가중치도 포함되어 새 웹앱에서 바로 분류할 수 있습니다. 학습 전에 내보낸 웹앱은 자체적으로 샘플 수집·학습을 할 수 있습니다.

카메라 영상 표시만 요청하면 `camera_stream` 위젯을 사용합니다. CNN을 요청하면 `image_classifier` 위젯의 입력에 `source: {type: "esp32_stream", url: "http://카메라IP/stream"}`을 사용합니다. 입력을 생략한 기존 분류기는 PC 웹캠을 사용합니다.

영상은 MJPEG에서 JPEG를 추출해 캔버스에 그립니다. 그 픽셀을 기존 MobileNet CNN 특징 추출기와 브라우저에서 학습하는 분류기에 입력합니다. 연속 분류는 약 500ms 간격이며, 학습·인식 이미지 자체를 Qwen이나 서버에 업로드하지 않습니다. 모델 파일은 최초 사용 시 인터넷에서 다운로드합니다.

카메라 펌웨어는 연속 스트림 하나를 처리합니다. Python 뷰어, 오른쪽 미리보기, 생성 위젯 중 **한 곳만 열고** 다른 곳은 끄세요. PC와 카메라는 같은 LAN에 있어야 합니다. 브라우저에서 로컬 네트워크 접근 권한을 요청하면 허용해야 합니다. HTTPS 페이지에서 HTTP 카메라가 차단되면 localhost의 HTTP 에디터에서 시험하세요. 브라우저 보안 기능을 끄지 않습니다.

검증 명령:

```bash
node camera/tests/planner.cjs
node camera/tests/browser.cjs
```

브라우저 테스트는 Chrome, Node의 `ws`, 테스트 JPEG 생성용 Python OpenCV/NumPy를 사용합니다. 카메라 전송·픽셀 읽기는 실제 브라우저로 검증하며, 기본 CNN 테스트는 다운로드 없이 모의 모델을 사용합니다. 실제 모델 다운로드·특징 추출·학습·예측까지 확인하려면 `REAL_CNN=1 node camera/tests/browser.cjs`를 사용합니다. 이 테스트의 HTTP 서버는 가짜 카메라/정적 테스트 페이지용이며 제품에 중계 서버를 추가하지 않습니다.


## 로봇 리모컨의 공통 속도 슬라이더

방향 버튼의 `speedFrom`은 같은 계획에 포함된 `type: "control"`, `action: {skill: "set_motor"}` 위젯의 **id**를 참조합니다. 슬라이더가 하나뿐이고 Qwen이 존재하지 않는 참조 ID를 생성한 경우 실제 모터 슬라이더로 보정합니다. 여러 슬라이더 사이에서는 임의 선택하지 않으며, 실제 서보·센서 ID를 잘못 참조한 경우도 거부합니다. 정지는 항상 속도 0을 사용합니다.

슬라이더를 요청했는데 누락된 계획은 수정 요청을 보냅니다. Qwen에 전체 리모컨(공통 슬라이더 + 네 방향 버튼 + 정지)의 생성 예시를 제공합니다.

```bash
node camera/tests/motor_planner.cjs
REAL_QWEN=1 node camera/tests/motor_planner.cjs
```

두 번째 명령은 실행 중인 로컬 Qwen 서버(`http://127.0.0.1:8080`)에서 실제 생성까지 확인합니다.


ESP32 영상은 수신과 JPEG 디코딩을 분리하고 최신 프레임 하나만 보관합니다. CNN이나 브라우저가 느릴 때 중간 프레임을 건너뛰어 과거 영상의 지연 누적을 줄입니다. 카메라 펌웨어 기본값은 320×240, 약 8fps입니다. 변경 후에는 카메라 펌웨어를 업로드하고 에디터를 새로고침하며, 이전에 내보낸 웹앱은 다시 생성·내보내기 하세요.


에디터의 카메라 창은 오른쪽 상단에 기본으로 표시됩니다. 브라우저 수신기는 일시적 끊김에 자동 재연결하며, 연결 상태·해상도·프레임 수를 표시합니다. **카메라 끄기** 또는 미리보기 패널 접기로 재연결을 중지합니다. 같은 페이지에서는 한 카메라 연결을 두 위젯이 서로 빼앗으며 재접속하지 않도록 새로 연 위젯에 연결을 넘깁니다. 생성한 독립 HTML에도 같은 복구 코드가 포함되며, 이전에 내보낸 파일은 다시 생성해야 합니다.

### 독립 실행과 지원 범위

내보낸 HTML은 PhyVibe 에디터나 Qwen을 실행하지 않아도 작동합니다. ESP32와 같은 네트워크에서 정적 웹 서버로 HTML을 제공하세요. 카메라·분류만 사용하는 앱은 브릿지 연결이 필요하지 않습니다. 분류 결과로 모터·서보를 제어하는 앱은 해당 하드웨어와 브릿지 서버가 필요합니다. 영상은 브라우저가 ESP32에서 직접 받으며 PC 영상 중계 서버는 사용하지 않습니다.

인터넷 없이 완전히 실행되는 패키지는 아닙니다. TensorFlow.js, MobileNet 라이브러리와 기본 모델은 인터넷에서 내려받습니다. 현재 스킬은 MobileNet V2 특징 추출 + 사용자 클래스 2–8개 학습·분류, 신뢰도 기준, 클래스별 장치 명령, 가위바위보 같은 클래스 관계 게임을 지원합니다. 객체 검출·OCR·ViT·영상 분할은 지원하지 않습니다.

시나리오 검증: `node camera/tests/planner.cjs`, `REAL_QWEN=1 node camera/tests/planner.cjs`, `REAL_CNN=1 node camera/tests/browser.cjs`. 실제 CNN 테스트는 학습한 가중치를 HTML에 저장하고 새 페이지에서 재학습 없이 예측하는 과정도 확인합니다.
