# micro:bit ↔ ESP32 ↔ Flask 송수신

micro:bit 숫자를 Flask로 전달하고, Flask가 응답한 `0`~`9` 숫자를 ESP32가 micro:bit로 다시 전달하는 테스트입니다.

이 버전의 HTTP 경로는 `/exchange`입니다. ESP32는 서버 응답이 정확히 `0`~`9` 중 한 글자인 경우에만 micro:bit로 전달합니다.

## 설정 명령

micro:bit에서 다음 문자열을 9600 baud로 한 줄씩 보냅니다.

```text
SSID:공유기 이름
PASSWORD:공유기 비밀번호
SERVER_IP:192.168.0.100
CONNECT
```

연결 후 micro:bit가 1초마다 숫자를 보내면 서버도 HTTP 응답 본문으로 `0`~`9`를 하나씩 순환해서 보냅니다. HTTP 응답 본문에는 줄바꿈 없이 숫자 한 글자만 들어갑니다.

ESP32도 받은 숫자를 `Serial2.write()`로 전달하므로 ESP32 → micro:bit UART에는 ASCII 숫자 한 바이트만 전송됩니다. `CR`, `LF`, 공백 및 기타 구분자는 붙지 않습니다.

## 배선

| micro:bit | ESP32 DevKit V1 |
|---|---|
| P14 (TX) | GPIO16 (RX2) |
| P15 (RX) | GPIO17 (TX2) |
| GND | GND |

ESP32 Serial0 디버깅 속도는 115200 baud입니다.

## 서버 실행

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python server.py
```

실행 시 `MODE: BIDIRECTIONAL 0-9 (/exchange)`가 표시되어야 합니다. `MODE: SEND ONLY`가 표시되면 다른 폴더의 서버를 실행한 것입니다.

micro:bit에서는 새 줄을 기다리지 말고 UART 수신 버퍼에서 정확히 1바이트를 읽어 LED에 표시합니다.
