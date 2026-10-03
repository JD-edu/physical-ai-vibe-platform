# 통신 브리지 서버

ESP32가 전송한 데이터를 HTTP로 받고, 웹 화면에서 입력한 명령을 TCP로 ESP32에 전달하는 Flask 서버입니다.

```bash
python -m venv .venv
source .venv/bin/activate
pip install flask
python server.py
```

- 웹/HTTP 포트: `5000`
- ESP32 명령 TCP 포트: `5001`

## Studio / 생성 웹앱 API

- `GET /api/status`: 최신 데이터, ESP32 명령 연결 수, 최근 20개 메시지 및 증가하는 메시지 ID를 반환합니다.
- `POST /api/command`: JSON `{"command":"CMD:servo:90"}`를 ESP32 TCP 연결에 전송합니다. micro:bit MakeCode 프로그램이 명령을 처리해야 합니다.
- ESP32 명령 연결이 없으면 HTTP 503을 반환합니다. 전송 성공은 micro:bit 실행 완료를 보장하지 않습니다.
- `/api/*`는 별도 출처에서 제공되는 Studio / 사용자 웹앱의 접근을 허용합니다. 인증 없는 로컬 교육용 서버이므로 신뢰하는 LAN에서 사용합니다.

Studio의 브릿지 URL에 `http://서버_PC_IP:5000`을 설정하세요. 05 bring-up의 에코 전용 서버 대신 이 서버를 사용하세요. Step 5 ESP32 펌웨어의 `/exchange` 센서 송신도 지원하며 원본 데이터를 에코합니다. 웹앱에서 명령을 보내려면 TCP 명령 연결을 지원하는 ESP32 펌웨어가 필요합니다.
