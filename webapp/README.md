# PHYVIBE Studio Webapp

상세 기획서의 Phase 1~3 핵심 기능을 구현한 의존성 없는 브라우저 MVP입니다.

## 빠른 실행

프로토타입은 별도 AI 서버 없이 내장 데모 엔진으로 바로 실행할 수 있습니다. 실제 로컬 LLM 생성을 시험하려면 별도 터미널에서 Qwen3 8B를 `8081` 포트로 실행합니다.

```bash
llama-server -m /path/to/Qwen3-8B.gguf --host 127.0.0.1 --port 8081 --alias qwen3-8b -c 8192
```

그다음 저장소 루트에서 웹 서버를 실행하고 `http://localhost:3000/webapp/`에 접속합니다.

```bash
python3 -m http.server 3000
```

Web Serial은 보안 정책상 `localhost` 또는 HTTPS 환경의 Chrome/Edge에서 사용해야 합니다.

## 구현 기능

- 자연어 프롬프트와 빠른 시작 칩을 통한 JSON 위젯 생성
- API 키 없이 동작하는 잔소리 화분/자율주행 터틀 데모 프리셋과 센서 시뮬레이션
- 라이브 뷰, 생성 코드, JSON 스키마 탭
- 데스크톱/태블릿/모바일 뷰포트 미리보기
- `ws://localhost:8080` 브릿지 연결과 실시간 패킷 반영
- Web Serial 9600bps 장치 연결 및 ESP32 Wi-Fi 프로비저닝
- 서보 0~180도, 모터 PWM -255~255 안전 클램핑
- 기획서 규격의 `DATA:<key>:<value>`, `CMD:*`, `MOT:L:R`, `WIFI:*` 텍스트 패킷 처리
- RX/TX 패킷 콘솔과 오류를 AI 프롬프트로 전달
- OpenAI/Gemini BYOK 로컬 저장 및 API 연결 테스트
- 프로젝트 JSON 내보내기, 링크/모바일 공유

## 로컬 Qwen3 8B

앱은 시작 시 llama.cpp의 `http://localhost:8081/v1/models`에서 로드된 Qwen 모델을 자동으로 찾습니다. 연결될 때까지 시작 화면에서 3초 간격으로 재시도합니다. 포트 `8080`은 장치 브릿지가 사용하므로 LLM 서버는 `8081`을 사용합니다.

```bash
llama-server -m /path/to/Qwen3-8B.gguf --host 127.0.0.1 --port 8081
```

위젯 생성은 로컬 llama.cpp의 OpenAI 호환 `/v1/chat/completions`를 사용합니다. `/v1/models`에서 실제 모델 ID를 읽기 때문에 GGUF 파일명과 모델 ID가 달라도 동작합니다. 기존 OpenAI와 Gemini 설정 및 연결 테스트도 그대로 유지됩니다.

llama.cpp 설치, GGUF 검색, CPU/GPU 옵션, Windows 명령 및 문제 해결은 저장소 최상위 `README.md`를 참고하세요.
