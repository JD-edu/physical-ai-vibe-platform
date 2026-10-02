# micro:bit MakeCode 확장

micro:bit의 P14(TX), P15(RX)를 사용해 ESP32와 9600bps UART로 통신합니다. Wi-Fi 설정, 서버 메시지 송수신, 모터 제어 블록을 제공합니다.

## 파일

- `main.ts`: 확장 블록 구현
- `test.ts`: 기본 동작 예제
- `pxt.json`: MakeCode 패키지 설정

## 배선

| micro:bit | ESP32 DevKit V1 |
|---|---|
| P14 TX | GPIO16 RX2 |
| P15 RX | GPIO17 TX2 |
| GND | GND |

MakeCode 패키지 관련 명령은 이 폴더에서 실행합니다.
