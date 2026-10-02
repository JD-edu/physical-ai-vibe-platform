# micro:bit ↔ ESP32 ↔ Flask + OLED + 웹

기존 양방향 숫자 송수신에 ESP32 OLED 표시와 Flask 웹 모니터를 추가한 독립 테스트입니다.

## OLED 표시

SSD1306 128×64, I2C 주소 `0x3C`를 사용합니다.

| 줄 | 표시 내용 |
|---|---|
| 1 | `SSID:<SSID>` |
| 2 | `<서버 IP> <연결 상태>` |
| 3 | `S>M:<서버→micro:bit 데이터>` |
| 4 | `M>S:<micro:bit→서버 데이터>` |

각 줄은 최대 21글자이며 넘치는 데이터는 앞부분 21글자만 표시합니다.

2번째 줄의 연결 상태는 다음과 같이 변경됩니다.

| 상태 | 의미 |
|---|---|
| `WAIT` | micro:bit 설정 대기 |
| `NOCFG` | SSID 또는 서버 IP 누락 |
| `WIFI` | 최초 Wi-Fi 연결 중 |
| `READY` | Wi-Fi 연결 완료 |
| `SEND` | Flask 서버로 HTTP 전송 중 |
| `OK` | 서버 응답 정상 |
| `RETRY` | 운전 중 Wi-Fi 재연결 중 |
| `WFAIL` | Wi-Fi 연결 실패 |
| `HFAIL` | HTTP 연결 또는 응답 실패 |
| `EMPTY` | 서버 응답 본문이 비어 있음 |

연결 처리 중 동일한 상태가 반복되면 OLED를 다시 그리지 않고, 상태가 변경될 때만 화면을 갱신합니다. SSID나 서버 IP처럼 표시 데이터 자체가 바뀌면 즉시 갱신합니다. 1·3·4번째 줄의 기존 내용은 재연결 과정에서도 유지됩니다.

## 배선

| 장치 | ESP32 DevKit V1 |
|---|---|
| micro:bit P14 (TX) | GPIO16 (RX2) |
| micro:bit P15 (RX) | GPIO17 (TX2) |
| micro:bit GND | GND |
| OLED SDA | GPIO21 |
| OLED SCL | GPIO22 |
| OLED GND | GND |
| OLED VCC | 3.3V |

micro:bit UART는 9600 baud, ESP32 Serial0 디버깅은 115200 baud입니다.

## 처리시간 측정

ESP32 Serial0 모니터를 115200 baud로 열면 HTTP 왕복과 OLED 전체 화면 전송 시간이 밀리초 단위로 출력됩니다.

```text
HTTP_MS:24.381
OLED_MS:22.714
```

- `HTTP_MS`: HTTP POST 시작부터 응답 본문 수신 및 연결 정리까지의 시간
- `OLED_MS`: SSD1306 전체 화면 버퍼를 I2C로 전송한 시간

두 값은 `micros()`로 측정하며 소수점 아래 3자리까지 출력합니다.

## micro:bit 설정 명령

```text
SSID:공유기 이름
PASSWORD:공유기 비밀번호
SERVER_IP:192.168.0.100
CONNECT
```

연결 후 micro:bit가 문자열을 한 줄씩 보내면 서버는 받은 전체 문자열을 HTTP 응답 본문으로 그대로 돌려줍니다. ESP32는 전체 문자열 뒤에 `CR+LF`를 붙여 micro:bit로 전달하므로 확장 블록의 `NewLine` 수신 이벤트로 읽을 수 있습니다.

예를 들어 micro:bit가 `12345`를 보내면 서버와 ESP32를 거쳐 micro:bit가 다시 받는 문자열도 `12345`입니다. OLED는 원본 전송 데이터를 변경하지 않고 화면에 들어가는 앞부분만 표시합니다.

## Arduino 라이브러리

- Adafruit GFX Library
- Adafruit SSD1306

## 서버와 웹페이지 실행

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python server.py
```

브라우저에서 `http://서버_PC_IP:5000/`을 열면 최신 양방향 데이터와 송수신 횟수가 표시됩니다. 화면은 0.5초마다 갱신됩니다.
