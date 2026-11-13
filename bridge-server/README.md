# Standalone PHYVIBE C++ bridge

This C++17 / Qt application is an independent network service shared by browser Studio, Electron Studio, and exported customer webapps. Studio never launches or embeds it.

```text
Qwen / llama.cpp :8080 ← Studio (generation)
                            │
Studio ─────────────────────┤ HTTP :5000
Customer webapps ───────────┤
                            ▼
                  Standalone C++ bridge
                            │ Wi-Fi, HTTP telemetry / TCP :5001 commands
                            ▼
                    ESP32 controller
                            │ direct GPIO/PWM
                            ▼
                      motors / servos
```

## Build on Ubuntu

Qt5 development libraries, GCC, and CMake are already installed on this PC. On a fresh Ubuntu setup:

```bash
sudo apt update
sudo apt install build-essential cmake qtbase5-dev
```

From the repository root:

```bash
cmake -S bridge-server -B bridge-server/build -DCMAKE_BUILD_TYPE=Release
cmake --build bridge-server/build --parallel 4
```

Or use `npm run build:bridge`, which runs those CMake commands. Electron and npm are not required for a direct CMake build. Qt6 can also be selected when its development libraries are available.

## Start the desktop UI

```bash
./bridge-server/build/phyvibe-bridge
```

The window opens **stopped**. Set ports if needed, then click **서버 시작** (Start server).

- The desktop connection diagram shows **웹앱 ↔ PhyVibe 연결 서버 ↔ PhyVibe 디바이스 (ESP32)** with Korean setup guidance.
- Server state follows the listeners; ESP32 state follows actual TCP command connections. The Wi-Fi label describes the network path, not signal strength or verified command execution.
- Webapp activity means a request to `/api/status` or `/api/command` in the last 5 seconds. It is an activity indicator, not a persistent browser connection; API tools can also trigger it. Health probes and device telemetry do not trigger it. Stopping the server resets it.
- Default HTTP port: **5000**.
- Default ESP32 TCP command port: **5001**.
- **Stop server** closes both listeners and all network clients; the UI remains open so you can restart.
- The monitor displays **RX**, **TX**, connection events, and errors.
- Latest RX/TX fields and ESP32 command connection count remain visible.
- You can enter literal text such as `a` and click **Send to ESP32** to test the return path.
- Port fields are editable while stopped. LAN addresses are displayed for configuring ESP32.
- Closing the bridge window stops its service. Closing Studio has no effect on this service.

To start immediately when opening the window:

```bash
./bridge-server/build/phyvibe-bridge --auto-start
```

For a terminal-only service:

```bash
./bridge-server/build/phyvibe-bridge --headless
```

For isolated testing or a different port assignment:

```bash
./bridge-server/build/phyvibe-bridge --headless --host 127.0.0.1 --port 15000 --tcp-port 15001
```

The default bind address is `0.0.0.0` so ESP32 can reach the server over the LAN. The local education API has no authentication; run it on a trusted LAN. HTTP bodies are limited to 16 KiB, headers to 8 KiB, and incomplete HTTP requests time out after 10 seconds.

## Connect Studio and customer webapps

Start the bridge separately and use the same HTTP URL in both clients:

- Same PC: `http://127.0.0.1:5000`.
- Other PC/mobile: `http://SERVER_PC_LAN_IP:5000`.

ESP32 must use the server PC's LAN address. A firewall must permit ports 5000/5001 for device access. Configure the control ESP32 in the desktop bridge's **ESP32 Wi-Fi 설정** tab over USB; it reconnects using saved settings. There is no browser USB/serial connection.

Changing the TCP command port also requires changing the ESP32 firmware's command port. Step 5 bring-up firmware sends telemetry through `/exchange`; it can continue using that endpoint. Receiving browser commands requires ESP32 firmware with the persistent TCP command connection.


## API compatibility

| Endpoint | Behavior |
|---|---|
| `GET /api/status` | Latest RX/TX, connected device count, sequence, recent 20 received messages |
| `GET /api/health` | Same status with server identity and version |
| `POST /receive` | Receives text sensor data; returns `OK` |
| `POST /exchange` | Receives text data; returns the trimmed data unchanged for Step 5 echo compatibility |
| `POST /api/command` | JSON `{"command":"a"}` broadcasts literal text to connected ESP32 TCP clients |
| `OPTIONS` | CORS preflight support for browser clients |

Status preserves the existing `latest_message`, `latest_time`, `latest_command`, `latest_command_time`, `message_history`, `message_sequence`, and `connected_clients` fields. Sensor data such as `DATA:temperature:25` updates widgets bound to `temperature`. TCP sensor messages are newline-framed and also enter the receive history.

Commands preserve case and spaces, are limited to 1–256 Unicode characters, and cannot contain CR/LF. The TCP transport adds one framing newline. An empty device connection list returns HTTP 503; malformed commands return HTTP 400. `sent_count` means bytes were queued to ESP32 connections, not that the physical output completed.

The old Python web monitor and `/send-command` form handler have been replaced by this desktop UI and `/api/command` JSON API. Studio and current exported webapps already use that API. Python servers in `physical/board-bring-up/` remain historical isolated tests, not the platform runtime.

## Test

```bash
ctest --test-dir bridge-server/build --output-on-failure
```

CMake enables tests by default. Python3 is used only as the integration-test client; it does not implement the running bridge. To build the runtime without requiring Python:

```bash
cmake -S bridge-server -B bridge-server/build -DBUILD_TESTING=OFF
cmake --build bridge-server/build --parallel 4
```

The tests cover real HTTP/TCP telemetry, echo compatibility, repeated messages, CORS, literal commands, broadcast, disconnects, malformed/oversized input, fragmented requests, listener rollback, GUI start/stop/restart with Qt's offscreen platform.

## Optional installation of the standalone executable

```bash
cmake --install bridge-server/build --prefix "$HOME/.local"
~/.local/bin/phyvibe-bridge
```

This installs the bridge separately from Studio. Qt runtime libraries are still required. It is a Linux executable, not a Python bundle or a Windows `.exe`.


## USB Wi-Fi setup for the control ESP32 and camera

The desktop window has three tabs: **브릿지 서버** for network status, HTTP/TCP ports, start/stop, RX/TX monitoring and commands; **카메라 Wi-Fi 설정** for camera provisioning; **ESP32 Wi-Fi 설정** for the control ESP32. Switching tabs keeps existing server and USB sessions alive.

For the control ESP32:

1. Upload `esp32/esp32_firmware/esp32_firmware.ino` together with `esp32_wifi_protocol.h` to the control ESP32. Start the bridge and note the server PC's LAN IPv4 address in **브릿지 서버**.
2. Close Arduino Serial Monitor. In **ESP32 Wi-Fi 설정**, select the control ESP32's USB port and click **USB 연결**. The bridge checks the firmware identity before enabling settings.
3. Enter the Wi-Fi SSID/password and the server PC's LAN IPv4 address, then click **설정 저장 및 ESP32 연결**. The ESP32 saves all three values together, reconnects and reports its Wi-Fi state and IP. It uses the saved values after reboot.

For the camera:

1. Upload the updated `camera/lilygo_camera_station` sketch, including its header. Install the Adafruit SSD1306/GFX libraries for the camera OLED.
2. Close Arduino Serial Monitor. Choose the camera port (usually `/dev/ttyUSB0`) and click **USB 연결**.
3. Enter the router SSID/password and click **설정 저장 및 카메라 연결**. The camera overwrites its saved configuration, reconnects, and returns its stream URL.
4. On connection failure, the camera OLED asks for setup again; resend settings in the same UI. Reconfiguration works even if a previous SSID was saved or connected.

Both tabs use the same nonblocking native USB serial implementation integrated with Qt's event loop. No QtSerialPort package or separate Python provisioning app is required. Each tab checks the correct firmware identity before sending credentials. The PC does not persist passwords or log the raw settings packet. A reconnect timeout leaves either device reachable over USB.

Video stays direct between the camera and the editor/generated app. This feature does not add a video relay. See [camera setup and OLED states](../camera/README.md).

`ctest --test-dir bridge-server/build --output-on-failure` includes pseudo-terminal/UI tests for both devices, ESP32 credential parser tests, camera credential storage-policy tests and the bridge window start/stop test. `BUILD_TESTING=OFF` builds the runtime without Qt Test or Python test tools.


## Connection health and network events

The **브릿지 서버** tab now distinguishes a TCP socket from a responsive ESP32 application. The connection diagram and per-device table show **응답 정상**, **응답 확인 중**, or **TCP 연결 · 생존 미확인**; after removal the diagram shows **연결 끊김**. The table includes peer address, last pong age and detection mode.

Upload the updated **control ESP32** sketch at `esp32/esp32_firmware/esp32_firmware.ino` to enable link monitoring. The separate camera module sketch is not involved. The ESP32 announces its Wi-Fi MAC using `PHYVIBE_LINK_HELLO:<id>`. The bridge sends `PHYVIBE_LINK_PING:<nonce>` about every 2 seconds and requires the matching `PHYVIBE_LINK_PONG:<nonce>` within 6 seconds. A silent failure is detected within approximately 6–8 seconds, subject to the event loop running. A normal TCP close/error is processed immediately. A new connection with the same device ID replaces the stale old socket.

These frames are consumed inside ESP32 and never forwarded to motor outputs or sensor history. They check the ESP32 application's link, not whether a motor command executed. There is no automatic command resend or actuator execution ACK.

Older firmware continues to receive only blank-line keepalives, with Linux TCP keepalive/user-timeout tuning as a fallback. Its application health cannot be verified, so update the firmware for the explicit response indicator and bounded link heartbeat timeout.

`networkEvent(QJsonObject)` emits transitions immediately to local Qt consumers. The monitor shows **NET** events with time, peer and reason. `/api/status` preserves existing fields and additionally returns:

- `healthy_clients`, `devices`: per-device mode, ID, state, recent RX/PONG age and awaiting-pong flag.
- `network_events`: latest 100 events with monotonically increasing `id`, `time`, `type`, `peer`, `reason`.
- `heartbeat_interval_ms`, `heartbeat_timeout_ms`, `web_active`, `web_idle_timeout_ms`.

Event types include `device_connected`, `device_online`, `device_error`, `device_disconnected`, `web_active`, `web_inactive`, `server_started`, `server_stopped`. HTTP clients may poll this event history; no browser session is inferred from an open TCP connection. Web activity expires after 5 seconds without API traffic and emits an event; it is not proof that a browser tab remains open.

Tests cover normal disconnect, no-pong timeout while the socket remains open, wrong nonce, reconnect replacement, UI updates, legacy compatibility, HTTP activity expiry and actual firmware handler framing.
