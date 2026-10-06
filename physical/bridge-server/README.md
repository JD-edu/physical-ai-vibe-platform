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
                    ESP32 Wi-Fi bridge
                            │ UART inside the hardware assembly
                            ▼
                  micro:bit controller (MakeCode)
```

## Build on Ubuntu

Qt5 development libraries, GCC, and CMake are already installed on this PC. On a fresh Ubuntu setup:

```bash
sudo apt update
sudo apt install build-essential cmake qtbase5-dev
```

From the repository root:

```bash
cmake -S physical/bridge-server -B physical/bridge-server/build -DCMAKE_BUILD_TYPE=Release
cmake --build physical/bridge-server/build --parallel 4
```

Or use `npm run build:bridge`, which runs those CMake commands. Electron and npm are not required for a direct CMake build. Qt6 can also be selected when its development libraries are available.

## Start the desktop UI

```bash
./physical/bridge-server/build/phyvibe-bridge
```

The window opens **stopped**. Set ports if needed, then click **Start server**.

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
./physical/bridge-server/build/phyvibe-bridge --auto-start
```

For a terminal-only service:

```bash
./physical/bridge-server/build/phyvibe-bridge --headless
```

For isolated testing or a different port assignment:

```bash
./physical/bridge-server/build/phyvibe-bridge --headless --host 127.0.0.1 --port 15000 --tcp-port 15001
```

The default bind address is `0.0.0.0` so ESP32 can reach the server over the LAN. The local education API has no authentication; run it on a trusted LAN. HTTP bodies are limited to 16 KiB, headers to 8 KiB, and incomplete HTTP requests time out after 10 seconds.

## Connect Studio and customer webapps

Start the bridge separately and use the same HTTP URL in both clients:

- Same PC: `http://127.0.0.1:5000`.
- Other PC/mobile: `http://SERVER_PC_LAN_IP:5000`.

ESP32 must use the server PC's LAN address. A firewall must permit ports 5000/5001 for device access. micro:bit remains programmed separately in MakeCode. There is no browser USB/serial connection.

Changing the TCP command port also requires changing the ESP32 firmware's command port. Step 5 bring-up firmware sends telemetry through `/exchange`; it can continue using that endpoint. Receiving browser commands requires ESP32 firmware with the persistent TCP command connection.

## Protocol v1

Version 2.1.0 supports tracked commands and execution ACKs. See [the v1 specification](../../protocol/v1.md) for the wire format and MakeCode setup. The manual-send checkbox enables v1; leave it unchecked for existing device programs.

POST `/api/command` with `{"protocol":"phyvibe-v1","command_id":"demo-001","command":"a"}` returns 202 when queued. GET `/api/commands/demo-001` returns `sent`, `acknowledged`, `failed`, `timed_out` or `connection_lost`. v1 requires exactly one ESP32 TCP client and limits payloads to 64 printable ASCII characters. ACK timeout is five seconds; a timeout does not prove the command failed to execute. No automatic resend occurs.

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

Commands preserve case and spaces, are limited to 1–256 Unicode characters, and cannot contain CR/LF. The TCP transport adds one framing newline. An empty device connection list returns HTTP 503; malformed commands return HTTP 400. `sent_count` means bytes were queued to ESP32 connections, not that micro:bit executed the command.

The old Python web monitor and `/send-command` form handler have been replaced by this desktop UI and `/api/command` JSON API. Studio and current exported webapps already use that API. Python servers in `physical/board-bring-up/` remain historical isolated tests, not the platform runtime.

## Test

```bash
ctest --test-dir physical/bridge-server/build --output-on-failure
```

CMake enables tests by default. Python3 is used only as the integration-test client; it does not implement the running bridge. To build the runtime without requiring Python:

```bash
cmake -S physical/bridge-server -B physical/bridge-server/build -DBUILD_TESTING=OFF
cmake --build physical/bridge-server/build --parallel 4
```

The tests cover real HTTP/TCP telemetry, echo compatibility, repeated messages, CORS, literal commands, broadcast, disconnects, malformed/oversized input, fragmented requests, listener rollback, v1 ACK success/error/timeout, duplicate IDs, and GUI start/stop/restart with Qt's offscreen platform.

## Optional installation of the standalone executable

```bash
cmake --install physical/bridge-server/build --prefix "$HOME/.local"
~/.local/bin/phyvibe-bridge
```

This installs the bridge separately from Studio. Qt runtime libraries are still required. It is a Linux executable, not a Python bundle or a Windows `.exe`.
