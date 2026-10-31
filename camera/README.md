# LilyGO T-Camera V1.6.2 — USB Wi-Fi 설정 및 직접 영상 수신

```text
설정: 브릿지 데스크톱 앱 ─ USB 시리얼 ─ ESP32 카메라 내부 저장소
영상: ESP32 카메라 ─ 공유기 ─ 에디터·생성 웹앱 또는 PC Python
```

카메라는 스테이션 모드로 동작합니다. 브릿지에 영상 중계 서버를 추가하지 않습니다.

## 1. 카메라 펌웨어 수동 업로드

Arduino IDE에서 `lilygo_camera_station/lilygo_camera_station.ino`를 엽니다. **같은 폴더의 `camera_wifi_protocol.h`도 함께 있어야 합니다.** `.ino`만 다른 프로젝트에 복사한다면 헤더 파일도 복사하세요.

- Espressif esp32 보드 패키지 2.x/3.x, 보드 **ESP32 Wrover Module**, PSRAM 활성화
- 포트 `/dev/ttyUSB0`, 업로드 속도 우선 115200
- 라이브러리: **Adafruit SSD1306**, **Adafruit GFX Library**, **Adafruit BusIO**
- 업로드 전 브릿지의 **USB 연결 해제**를 누릅니다. 업로드 후 Arduino Serial Monitor도 닫습니다.

`WIFI_SSID`와 `WIFI_PASSWORD`는 첫 부팅에 사용할 선택적 기본값입니다. 앞으로는 비워 두어도 브릿지에서 설정할 수 있습니다. USB로 저장한 설정이 있으면 코드의 기본값보다 먼저 사용합니다. 이미 작성한 기본값은 이번 수정에서 보존했습니다.

## 2. 브릿지 앱에서 설정

```bash
npm run build:bridge
npm run bridge
```

1. **ESP32 카메라 · USB Wi-Fi 설정**에서 카메라 포트를 선택합니다. 예: `/dev/ttyUSB0`. micro:bit의 `/dev/ttyACM0`와 구분하세요.
2. **USB 연결**을 누르면 카메라 펌웨어를 확인합니다. 서버 시작 버튼과 무관하게 설정할 수 있습니다.
3. 2.4 GHz 공유기의 SSID와 비밀번호를 입력하고 **설정 저장 및 카메라 연결**을 누릅니다.
4. 카메라는 기존 저장값을 새 SSID·비밀번호로 덮어쓰고 즉시 재연결합니다. 이미 연결되어 있거나 연결 시도 중이어도 새 설정을 전송할 수 있습니다.
5. 성공하면 브릿지의 카메라 스트림 주소에 `http://카메라IP/stream`이 표시됩니다. 이 주소를 복사해 에디터 또는 Python에서 사용합니다.

설정은 카메라의 Preferences/NVS에 SSID·비밀번호 한 쌍으로 저장됩니다. 재부팅해도 유지되며 펌웨어 기본값보다 우선합니다. PC에는 비밀번호를 저장하지 않습니다. 입력은 마스킹하고 전송 후 지우며, 시리얼 설정 패킷이나 비밀번호를 브릿지 로그에 출력하지 않습니다.

비밀번호는 UTF-8 8~63바이트입니다. 개방형 네트워크만 빈 값으로 입력합니다. SSID는 UTF-8 1~32바이트이며 앞뒤 공백을 임의로 제거하지 않습니다.

## 3. OLED와 연결 실패

- 설정 없음: `WiFi NOT SET` / `Set SSID/password` / `Bridge USB settings`
- 연결 중: `WiFi CONNECTING`
- 연결 성공: `CAMERA READY` / 카메라 IP
- 20초 안에 연결 실패: `WiFi FAILED` / `Set WiFi again` / `Bridge USB settings`

실패하면 브릿지에서 SSID와 비밀번호를 다시 보내세요. 실패 중에도 USB 명령은 처리합니다. 잘못된 비밀번호를 저장했다고 이전 설정으로 자동 복귀하지 않습니다. 새 설정을 저장하면 그 값이 다음 부팅에도 사용됩니다. 연결 완료 후 무선이 끊어지면 한 번 재연결을 시도하고, 실패하면 같은 재설정 안내를 표시합니다.

OLED가 연결되지 않거나 초기화에 실패해도 브릿지의 USB 설정과 상태 표시는 사용할 수 있습니다. 카메라 센서 초기화에 실패한 경우에도 Wi-Fi 설정은 가능합니다.

## 4. 영상 수신

PC를 카메라와 같은 LAN에 연결합니다. USB 설정 연결을 끊어도 카메라에 전원이 있으면 영상은 Wi-Fi로 계속 전송됩니다.

```bash
python3 -m pip install -r camera/requirements.txt
python3 camera/receive_camera_station.py --url http://카메라IP/stream
```

Python 화면은 Q/Esc/Ctrl+C로 종료하고 S로 한 장을 저장합니다.

```bash
python3 camera/receive_camera_station.py --url http://카메라IP/stream --no-display --frames 30 --save frame.jpg
```

PhyVibe 에디터에서는 오른쪽 **ESP32 카메라 실시간 영상**에 같은 주소를 입력합니다. CORS/OPTIONS 응답과 직접 브라우저 CNN 처리는 유지했습니다. Python·에디터 미리보기·생성 웹앱 중 한 곳에서만 연속 스트림을 엽니다.

## USB 명령 형식 (브릿지 개발용)

115200 baud, 8N1, 줄바꿈 구분입니다. 원문 SSID/비밀번호를 출력하지 않기 위해 설정값은 UTF-8 바이트를 16진수로 변환하지만, 이는 암호화가 아닙니다. 브릿지는 전송 패킷을 로그에 남기지 않습니다.

```text
CAMERA_WIFI_STATUS
CAMERA_WIFI_SET <SSID의 UTF-8 hex> <비밀번호의 UTF-8 hex 또는 빈 값의 경우 ->
```

응답은 `CAMERA_WIFI ` 접두사 뒤의 JSON이며 `device`, `protocol`, `state`, `ssid`, `stored`, `ip`, `url`을 포함합니다. 비밀번호는 응답하지 않습니다. PC는 카메라 식별 응답을 확인한 후에만 설정을 전송합니다.

## 검증

```bash
ctest --test-dir bridge-server/build --output-on-failure
```

가상 USB 포트를 사용해 UI 전송·상태 표시·기존 설정 덮어쓰기·잘못된 장치 거부를 검증합니다. 같은 펌웨어 저장 도우미로 기본값/저장값 우선순위, 두 번 갱신, 저장 실패 시 기존 값 유지도 검증합니다. 실제 보드에 대한 설정 전송·업로드는 자동으로 실행하지 않습니다.

[공식 V1.6.2 핀 표](https://github.com/Xinyuan-LilyGO/LilyGo-Camera-Series/blob/master/docs/T_CarmerV162.md)를 적용했습니다. OLED는 GPIO21/22, SSD1306 128×64, 주소 0x3C를 사용합니다.


## 화면 지연을 줄이는 기본 설정

펌웨어는 PSRAM 유무와 관계없이 **320×240(QVGA)**, JPEG 품질 인덱스 **22**, 최대 약 **8fps**로 전송합니다. 화질과 프레임 수보다 작은 전송량과 최신 장면을 우선합니다. PSRAM에서는 두 프레임 버퍼와 `CAMERA_GRAB_LATEST`를 유지합니다. 프레임 처리에 든 시간을 제외한 나머지만 대기하므로 느린 송신 뒤에 고정 지연을 추가하지 않습니다.

TCP 지연 전송을 줄이고, 응답 없는 수신기의 전송 대기는 3초로 제한합니다. 짧은 Wi-Fi 지연에도 끊김을 일으킬 수 있던 500ms 초과 강제 종료는 제거했습니다. 수신기는 최신 프레임만 남기므로 연결을 반복적으로 끊는 대신 과거 프레임을 건너뛰어 지연 누적을 줄입니다.

Python 수신기는 백그라운드에서 스트림을 계속 읽고 **가장 최근 JPEG 하나만** 보관합니다. 디코딩/화면 표시가 늦어져도 밀린 프레임을 순서대로 재생하지 않습니다. `--frames`는 네트워크 도착 수가 아니라 실제 디코딩한 프레임 수입니다. 브라우저 역시 네트워크 읽기와 이미지 디코딩을 분리해 최신 프레임만 대기시킵니다. 기존에 내보낸 HTML은 다시 생성해야 적용됩니다.

```bash
node camera/tests/latency.cjs
python3 camera/tests/test_latency.py
```

해상도·대기열 조정으로 지연 누적을 줄이는 것이며, 무선 품질·카메라 노출·브라우저 처리에 의한 지연을 0으로 보장하지는 않습니다. 실물에서의 지연 시간은 수동 업로드 후 확인해야 합니다.


## 에디터 카메라 창과 자동 복구

에디터 오른쪽 상단에 **ESP32 카메라 실시간 영상** 창이 기본으로 펼쳐집니다. 브릿지에서 확인한 URL을 넣고 **카메라 열기**를 누릅니다. 해상도와 수신 프레임 수로 영상이 계속 도착하는지 확인할 수 있습니다. 카메라 창을 접거나 **카메라 끄기**를 누르면 재접속도 중지됩니다.

일시적인 연결 종료나 타임아웃은 1초부터 최대 5초 간격으로 자동 재접속합니다. 재접속 중에는 마지막 화면을 흐리게 표시하고 CNN에 오래된 영상을 입력하지 않습니다. 처음부터 연결되지 않는 경우는 세 번 시도한 뒤 주소/권한 확인을 안내합니다. 잘못된 주소(HTTP 4xx)나 MJPEG가 아닌 응답은 바로 안내합니다. 단일 JPEG 디코딩 실패는 건너뛰고 세 번 연속 실패할 때 재연결합니다.

같은 에디터 페이지의 다른 위젯에서 동일한 카메라를 열면 기존 창을 멈추고 새 창으로 연결을 넘깁니다. 별도 Python 프로그램이나 다른 브라우저 탭의 연결은 자동으로 제어할 수 없으므로 직접 닫아 주세요. 영상은 계속 ESP32에서 직접 수신하며 중계 서버는 없습니다.
