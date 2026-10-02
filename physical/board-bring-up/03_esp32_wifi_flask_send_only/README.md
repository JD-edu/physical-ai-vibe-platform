# micro:bit → ESP32 → Flask 송신 전용

micro:bit가 보낸 숫자를 ESP32가 Flask 서버로 전달하기만 하는 테스트입니다. 서버에서 micro:bit로 보내는 데이터는 없습니다.

이 버전의 HTTP 경로는 `/send`이며 서버 응답 `OK`는 ESP32가 micro:bit로 전달하지 않습니다.

## 설정 명령

micro:bit에서 다음 문자열을 9600 baud로 한 줄씩 보냅니다.

```text
SSID:공유기 이름
PASSWORD:공유기 비밀번호
SERVER_IP:192.168.0.100
CONNECT
```

연결 후에는 1초마다 증가하는 숫자를 한 줄씩 보냅니다.

## 배선

| micro:bit | ESP32 DevKit V1 |
|---|---|
| P14 (TX) | GPIO16 (RX2) |
| GND | GND |

ESP32 Serial0 디버깅 속도는 115200 baud입니다.

## 서버 실행

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python server.py
```

실행 시 `MODE: SEND ONLY (/send)`가 표시됩니다.
