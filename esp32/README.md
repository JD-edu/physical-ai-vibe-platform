# ESP32 펌웨어

micro:bit UART 명령을 받아 Wi-Fi 및 서버 통신을 수행하고, OLED와 TB6612FNG 모터 드라이버를 제어하는 Arduino 펌웨어입니다.

Arduino IDE에서 `esp32_firmware.ino`를 열어 업로드하세요. `Adafruit GFX Library`와 `Adafruit SSD1306` 라이브러리가 필요합니다.

## Repeated Wi-Fi disconnects

The reconnect fix preserves a working station link when micro:bit sends repeated `CONNECT` commands with unchanged credentials. Changing credentials still causes a deliberate reconnect; changing only server IP closes only the TCP server connection. Each failed Wi-Fi attempt gets a 20-second connection window and then waits five seconds before the next attempt. ESP32-core auto-reconnect is disabled to keep one retry owner. A server-only connection failure retries TCP without disconnecting Wi-Fi.

Compile and upload `esp32_firmware/esp32_firmware.ino` in Arduino IDE. The UART between micro:bit and ESP32 is **115200 baud**. Keep `setupWiFiAndServer()` in startup code rather than a forever loop.

Open ESP32 USB Serial Monitor at **115200 baud** during the next test:

- `BOOT reset_reason=<number>` appearing repeatedly means the ESP32 itself is restarting. A reset reason identifies the reset mechanism, not always the underlying physical cause.
- `WIFI_EVENT disconnected reason=<number>` records the Wi-Fi driver's disconnect reason. Deliberate disconnects during initial connection, settings changes or explicit DISCONNECT/CLEAR also produce events.
- Repeated `micro:bit -> CONNECT` / `CONNECT_ACCEPTED` means the micro:bit program is sending repeated setup requests. Unchanged credentials no longer reset a healthy connection.
- `SERVER_FAILED` while Wi-Fi stays connected means TCP port 5001 / server IP / bridge availability must be checked.
- `HTTP telemetry status=<number>` distinguishes HTTP failures from Wi-Fi failures. Only HTTP 2xx counts as successful delivery.

Password commands are redacted from USB logs. The OLED UART label is derived from `MICROBIT_BAUD`, so it cannot disagree with the configured baud rate.

Host behavior checks (from the platform root):

```bash
python3 tests/test_esp32_reconnect.py
```

This compiles the actual connection functions against simulated Wi-Fi/clock APIs and tests duplicate CONNECT handling, settings changes, server-only retries and retry timing. It does not establish the cause of a failure on a real board; the USB logs above are required for that diagnosis.

The Arduino-ESP32 Wi-Fi event and reconnect APIs are described in [Espressif's Wi-Fi documentation](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/wifi.html).


## 브릿지 연결 상태 감시

브릿지의 연결 상태 감시를 사용하려면 이 제어용 ESP32 펌웨어를 다시 수동 업로드합니다. 카메라 모듈 펌웨어가 아닙니다.

연결 시 MAC 주소로 장치를 식별하고, 브릿지의 2초 간격 연결 확인에 ESP32가 직접 응답합니다. 6초 동안 응답하지 않으면 브릿지는 소켓을 닫고 연결 끊김 이유를 NET 로그에 남깁니다. 전원/무선의 갑작스런 끊김은 마지막 응답 시점에 따라 약 6–8초 뒤 감지됩니다. 정상 종료는 TCP 이벤트로 즉시 반영됩니다.

`PHYVIBE_LINK_`로 시작하는 내부 신호는 micro:bit UART와 OLED 명령 표시로 넘기지 않습니다. 모터 명령의 실행 확인이나 재전송 기능이 아닙니다. TCP 수신은 줄 단위 버퍼를 사용하므로 분할된 명령도 완성된 뒤 한 번만 전달합니다.

```bash
python3 esp32/tests/test_link_frames.py
ctest --test-dir bridge-server/build --output-on-failure
```
