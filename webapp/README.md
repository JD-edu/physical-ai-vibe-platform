# PHYVIBE Studio Webapp

상세 기획서의 Phase 1~3 핵심 기능을 구현한 의존성 없는 브라우저 MVP입니다.

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

- 자연어 프롬프트와 빠른 시작 칩을 통한 JSON 위젯 생성
- API 키 없이 동작하는 잔소리 화분/자율주행 터틀 데모 프리셋과 센서 시뮬레이션
- 라이브 뷰, 생성 코드, JSON 스키마 탭
- 데스크톱/태블릿/모바일 뷰포트 미리보기
- 설정 가능한 HTTP/HTTPS 브릿지 URL과 1초 간격 네트워크 센서 데이터 조회
- 네트워크 명령 전송: 서버 → ESP32 Wi-Fi 브릿지 → micro:bit 컨트롤러
- 서보 0~180도, 모터 PWM -255~255 안전 클램핑
- 기획서 규격의 `DATA:<key>:<value>`, `CMD:*`, `MOT:L:R`, `WIFI:*` 텍스트 패킷 처리
- 실제 네트워크 RX/TX 모니터와 네트워크 오류를 AI 프롬프트로 전달 (가상 센서 패킷 없음)
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

1. `physical/bridge-server`에서 `pip install flask` 후 `python server.py`를 실행합니다.
2. ESP32에 서버 PC의 IP를 설정하고 micro:bit MakeCode 프로그램으로 연결합니다. Wi-Fi 설정은 보드 측에서 수행합니다.
3. 스튜디오의 **브릿지 서버 URL**에 `http://서버_PC_IP:5000`을 입력하고 연결 토글을 켭니다. 같은 PC에서는 `http://localhost:5000`을 사용할 수 있습니다.
4. Local Qwen을 선택하고 **웹 UI** 생성 요청을 입력합니다. 센서 ID는 micro:bit가 보내는 `DATA:<key>:<value>`의 key와 일치해야 합니다.
5. **웹앱 내보내기**로 `phyvibe-webapp.html`을 저장합니다. 내보낸 웹앱은 Studio나 LLM 없이 실행됩니다. 웹 서버에서 제공하고 브릿지 URL을 확인한 뒤 연결하세요.

HTTPS 페이지에서는 HTTPS 브릿지를 사용하세요. 다른 PC나 모바일에서 `localhost`는 그 장치 자신을 가리키므로 서버 PC의 네트워크 주소를 사용합니다.

서버 연결 상태와 ESP32 연결 수는 별도로 표시됩니다. 서버에 연결되었더라도 ESP32 명령 TCP 연결이 없으면 명령은 실패합니다. 성공 표시는 서버가 ESP32 TCP 연결로 전송한 것을 의미하며 micro:bit의 실행 확인은 아닙니다.

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

버튼은 `actions` 배열에 `send_text` 스킬을 지정하고 순서대로 실행합니다. 다른 위젯은 `action`을 지정합니다. 문자열에는 접두사나 숫자를 추가하지 않습니다. 네트워크 전송 실패 시 남은 버튼 동작은 중지합니다. 성공은 서버→ESP32 전달을 뜻하며 micro:bit 실행 완료는 아닙니다.

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
python3 tests/test_network_bridge.py
```
