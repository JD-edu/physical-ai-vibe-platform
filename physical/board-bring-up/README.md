# Board bring-up

보드와 서비스의 기능을 한 단계씩 분리해서 확인하는 테스트 코드입니다.

## 1. micro:bit ↔ ESP32 UART 테스트

ESP32 스케치: `esp32_microbit_uart/esp32_microbit_uart.ino`

최종 ESP32 펌웨어에서 UART 통신과 Serial0 디버깅에 필요한 부분만 남겼습니다. Wi-Fi, 테스트 서버, OLED, 모터 코드는 포함하지 않습니다.

### 배선

두 보드는 모두 3.3 V UART이므로 아래처럼 연결합니다. TX와 RX는 서로 교차하며 GND는 반드시 공통으로 연결합니다.

| micro:bit | ESP32 DevKit V1 | 방향 |
|---|---|---|
| P14 (TX) | GPIO16 (RX2) | micro:bit → ESP32 |
| P15 (RX) | GPIO17 (TX2) | ESP32 → micro:bit |
| GND | GND | 공통 접지 |

이 테스트에서는 각 보드를 USB로 따로 전원 공급하고, 두 보드의 3V 핀이나 5V/VIN 핀은 서로 연결하지 않습니다.

### ESP32 업로드와 시리얼 모니터

1. Arduino IDE에서 `esp32_microbit_uart.ino`를 엽니다.
2. 사용하는 ESP32 보드와 포트를 선택해서 업로드합니다.
3. Arduino IDE 시리얼 모니터를 열고 속도를 **115200 baud**로 설정합니다.
4. 정상 부팅하면 `Waiting for micro:bit PING...`이 표시됩니다.

별도 라이브러리는 필요하지 않습니다.

### micro:bit MakeCode 블록

`시작할 때` 블록 안에 다음 순서로 배치합니다.

1. `고급` → `시리얼` → **시리얼 연결을 TX P14, RX P15, 전송 속도 115200으로 재지정**
2. `기본` → **500 ms 일시중지**

그다음 `무한 반복` 블록 안에 다음 순서로 배치합니다.

1. `시리얼` → **문자열 한 줄 쓰기 "PING"**
2. 변수 `응답`을 `시리얼` → **구분 기호 새 줄까지 문자열 읽기**로 설정
3. `만약 응답 = "PONG" 이면` 블록에서 LED에 체크(✓) 아이콘 표시
4. `아니면` 블록에서 LED에 X 아이콘 표시
5. **1000 ms 일시중지**

MakeCode JavaScript로 비교하면 핵심 동작은 다음과 같습니다.

```typescript
serial.redirect(SerialPin.P14, SerialPin.P15, BaudRate.BaudRate115200)
basic.pause(500)

basic.forever(function () {
    serial.writeLine("PING")
    let 응답 = serial.readUntil(serial.delimiters(Delimiters.NewLine))
    if (응답 == "PONG") {
        basic.showIcon(IconNames.Yes)
    } else {
        basic.showIcon(IconNames.No)
    }
    basic.pause(1000)
})
```

### 정상 동작 확인

micro:bit LED에는 체크 아이콘이 표시되고, ESP32 시리얼 모니터에는 아래 두 줄이 약 1초마다 반복됩니다.

```text
micro:bit -> ESP32: PING
ESP32 -> micro:bit: PONG
```

micro:bit에서 `PING` 이외의 문자열을 한 줄로 보내면 ESP32는 `ECHO:<받은 문자열>`을 반환하므로 추가 송수신 테스트에도 사용할 수 있습니다.

### 문제가 있을 때

- 시리얼 모니터에 수신 로그가 없으면 P14→GPIO16 배선과 공통 GND를 먼저 확인합니다.
- ESP32에는 수신 로그가 있지만 micro:bit가 X를 표시하면 GPIO17→P15 배선을 확인합니다.
- 글자가 깨지면 micro:bit UART, ESP32 UART2, ESP32 시리얼 모니터가 모두 115200으로 설정되어 있는지 확인합니다.
- MakeCode의 `문자열 한 줄 쓰기`를 사용해야 끝에 새 줄(`\n`)이 붙습니다.

## 2. ESP32 → micro:bit 한 문자 전송 테스트

ESP32 스케치: `esp32_to_microbit_1byte/esp32_to_microbit_1byte.ino`

ESP32가 micro:bit로 한 글자와 줄바꿈을 전송하고, micro:bit가 기존의 `새 줄까지 읽기` 방식으로 수신한 문자를 LED에 표시하는지 확인하는 단방향 테스트입니다.

### 배선

| ESP32 DevKit V1 | micro:bit | 방향 |
|---|---|---|
| GPIO17 (TX2) | P15 (RX) | ESP32 → micro:bit |
| GND | GND | 공통 접지 |

각 보드는 USB로 따로 전원 공급하고, 두 보드의 전원 핀은 서로 연결하지 않습니다. 이 테스트에는 micro:bit P14와 ESP32 GPIO16 연결이 필요하지 않습니다.

### 전송 사양

- micro:bit UART 속도: **9600 baud**, 8 data bits, no parity, 1 stop bit(8N1)
- ESP32 Serial0 디버깅 속도: **115200 baud**
- 전송 주기: 1초
- 전송 데이터: ASCII 문자 `0`부터 `9`까지 순환
- 한 줄의 payload: ASCII 문자 1바이트
- payload 뒤에 줄바꿈(`\r\n`)을 추가하므로 실제 전송 크기는 총 3바이트

전송되는 바이트 값은 다음과 같습니다.

| LED 표시 문자 | ASCII 값 |
|---|---|
| `0` | `0x30` |
| `1` | `0x31` |
| ... | ... |
| `9` | `0x39` |

### ESP32 업로드와 확인

1. Arduino IDE에서 `esp32_to_microbit_1byte.ino`를 엽니다.
2. ESP32에 업로드합니다.
3. 시리얼 모니터를 **115200 baud**로 엽니다.
4. 부팅 후 2초가 지나면 `0`부터 `9`까지 1초마다 전송됩니다.

시리얼 모니터에는 다음과 같이 표시됩니다.

```text
Sent line: '0' (0x30)
Sent line: '1' (0x31)
Sent line: '2' (0x32)
```

### micro:bit 측 동작 조건

micro:bit UART를 **TX P14, RX P15, 9600 baud**로 설정합니다. 기존 코드처럼 새 줄까지 문자열을 읽고 받은 ASCII 숫자 문자를 LED에 표시합니다. 정상이라면 LED에 `0`, `1`, `2`, ..., `9`가 1초 간격으로 반복 표시됩니다.

### 문제가 있을 때

- ESP32 시리얼 모니터에는 전송 로그가 있지만 LED에 표시되지 않으면 GPIO17→P15 배선과 공통 GND를 확인합니다.
- 다른 문자나 깨진 문자가 표시되면 micro:bit UART와 ESP32 UART2가 모두 9600 baud로 설정되었는지 확인합니다.
- 수신이 시작되지 않으면 micro:bit에서 새 줄(`NewLine`)까지 읽도록 설정되어 있는지 확인합니다.
