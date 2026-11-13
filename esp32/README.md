# ESP32 직접 제어 펌웨어

`esp32_firmware/esp32_firmware.ino`는 브릿지 서버와 Wi-Fi/TCP로 연결하고 모터와 서보 명령을 ESP32 GPIO에서 직접 실행합니다. Arduino IDE에서 ESP32 보드용으로 업로드하세요. `Adafruit GFX Library`, `Adafruit SSD1306`이 필요합니다.

## 배선

| 장치 | ESP32 GPIO |
|---|---|
| TB6612FNG STBY / PWMA / PWMB | 5 / 12 / 13 |
| TB6612FNG AIN1 / AIN2 / BIN1 / BIN2 | 14 / 15 / 18 / 19 |
| OLED SDA / SCL | 21 / 22 |
| servo / valve / mouth 제어 신호 | 25 / 26 / 27 |

서보 전원은 ESP32 GPIO에서 공급하지 말고 별도 전원을 사용하며 GND를 공유하세요. 실제 배선이 다르면 펌웨어 상단의 핀 상수를 바꿔야 합니다.

## 초기 Wi-Fi 설정

1. 제어용 ESP32에 `esp32_firmware/esp32_firmware.ino`와 같은 폴더의 `esp32_wifi_protocol.h`를 함께 업로드합니다.
2. 데스크톱 브릿지 앱을 실행하고 **브릿지 서버** 탭에서 서버 PC의 LAN IPv4 주소를 확인합니다.
3. Arduino 시리얼 모니터를 닫고 **ESP32 Wi-Fi 설정** 탭에서 제어용 ESP32의 USB 포트를 선택해 **USB 연결**을 누릅니다.
4. Wi-Fi SSID, 비밀번호, 서버 PC의 LAN IPv4 주소를 입력하고 **설정 저장 및 ESP32 연결**을 누릅니다. 연결 상태와 ESP32 IP가 표시되며, 설정은 재부팅 후에도 유지됩니다. 카메라 모듈은 별도의 **카메라 Wi-Fi 설정** 탭에서 설정합니다.

브릿지 UI를 사용할 수 없을 때는 USB 시리얼 모니터를 **115200 baud, 줄바꿈**으로 열고 다음을 한 줄씩 전송할 수도 있습니다.

```text
SSID:무선랜이름
PASSWORD:무선랜비밀번호
SERVER_IP:브릿지_PC의_LAN_IP
CONNECT
```

`CONNECT`는 설정을 ESP32 비휘발성 저장소에 저장합니다. 이전 시리얼 모니터 방식의 저장값도 새 펌웨어가 읽습니다. `DISCONNECT`는 이번 실행의 연결을 끄고 모터를 정지합니다. `CLEAR`는 저장된 설정을 지우고 모터를 정지합니다. 비밀번호는 USB 로그에 출력하지 않습니다.

브릿지 앱을 시작하고 HTTP 5000/TCP 5001 포트를 허용하세요. ESP32는 `PHYVIBE_LINK_HELLO`와 `PING/PONG`으로 연결 상태를 알립니다. 브릿지가 명령을 큐에 넣었다는 응답은 모터·서보 실행 완료 확인이 아닙니다.

## 직접 처리하는 명령

| 명령 | 동작 |
|---|---|
| `CMD:motor:forward:50` | 두 모터 전진 |
| `CMD:motor:backward:50` | 두 모터 후진 |
| `CMD:motor:left:50` / `CMD:motor:right:50` | 제자리 회전 |
| `CMD:motor:stop:0` | 모터 정지 |
| `CMD:motor:50` / `CMD:motor:0` | 두 모터 전진 / 정지 |
| `MOT:100:-100` | 좌우 PWM 직접 지정 (-255..255) |
| `CMD:servo:90`, `CMD:valve:90`, `CMD:mouth:90` | 해당 GPIO 서보 각도 (0..180) |

서보 PWM은 50 Hz, 500–2500 μs 범위를 사용합니다. 실제 서보의 허용 펄스 폭에 맞게 조정하세요. 임의 텍스트 명령은 USB 로그에 `Unsupported device command`로 표시되며 물리 출력은 없습니다. 센서 데이터를 사용하려면 센서를 ESP32에 직접 연결하고 `sendToServer("DATA:key:value")`를 호출하는 코드를 추가해야 합니다.

## 검증

```bash
python3 esp32/tests/test_device_commands.py
python3 esp32/tests/test_link_frames.py
```

이 테스트는 직접 모터·서보 명령 파서와 서버의 분할된 TCP 명령·연결 확인 프레임을 확인합니다. 실제 GPIO와 서보 동작은 업로드한 보드에서 확인해야 합니다.
