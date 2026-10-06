# micro:bit ESP32 Wi-Fi UART extension — Protocol v1

MakeCode extension version **0.1.2**. Commands arriving through the ESP32 can now control a configured servo and return v1 success/error acknowledgements. Existing Wi-Fi and ESP32 motor blocks remain available.

## UART wiring and baud rate

| micro:bit | ESP32 |
|---|---|
| P14 TX | GPIO16 RX2 |
| P15 RX | GPIO17 TX2 |
| GND | GND |

Call `startWithBaudRate(BaudRate.BaudRate115200)` first to match the current platform ESP32 firmware. For older firmware, select its actual baud rate (for example 9600). P14/P15 are reserved for UART and cannot be configured as servo pins.

## Servo example — copy into your MakeCode project

Add this updated extension to your MakeCode project, then use `examples/protocol-v1-servo.ts`. Set Wi-Fi credentials/server IP and change **P0** to the pin connected to your servo signal:

```typescript
esp32wifiuart.startWithBaudRate(BaudRate.BaudRate115200)
esp32wifiuart.configureServo(esp32wifiuart.ServoTarget.Servo, AnalogPin.P0)
esp32wifiuart.onServerMessage(function () {
    esp32wifiuart.executeServerCommand()
})
esp32wifiuart.setupWiFiAndServer("YOUR_SSID", "YOUR_PASSWORD", "YOUR_SERVER_LAN_IP")
basic.forever(function () {
    esp32wifiuart.sendSensor("temperature", input.temperature())
    basic.pause(2000)
})
```

Compile/download in MakeCode and upload to micro:bit. Select **Protocol v1 · micro:bit servo** in the updated Studio, generate a servo slider, connect the bridge and apply an angle. Existing downloaded webapps must be regenerated to select the new profile. The initial example configures only `servo`; configure `Valve` or `Mouth` and extend the Studio device profile when your hardware/program implements those targets.

## Received servo angle value block

Use **received servo angle** (`receivedServoAngle(ServoTarget.Servo)`) inside the server-message event to obtain a number:

```text
CMD:servo:134                  → 134
V1:CMD:id-001:CMD:servo:134     → 134
CMD:servo:0                    → 0
CMD:servo:181 / unrelated text → -1
```

The target dropdown also supports `valve` and `mouth`. A command for a different target returns -1. **received valid servo command** (`isServoCommand(...)`) is a condition block: use it before passing the value to a servo output block. Zero is a valid angle; do not test the angle as a boolean.

These blocks only read the received message. They do not move hardware or send ACKs, and they do not require `configureServo`. Your own servo block chooses the pin. For v1 commands, call `acknowledgeCommand(id)` after applying the value, or `rejectCommand(id, code)` if your operation fails. Capture ID and angle before any operation that yields.

`examples/protocol-v1-servo-value.ts` shows this complete pattern, using a standard MakeCode servo output block on P0. Use either your custom pattern or `executeServerCommand()` for a command, so it is not executed twice.

## New blocks

| Block / function | Purpose |
|---|---|
| `startWithBaudRate(baud)` | Start P14/P15 UART with an explicit baud rate |
| `configureServo(target, pin)` | Map servo/valve/mouth to a signal pin, without moving it |
| `setServoAngle(target, angle)` | Locally apply an integer angle, 0–180; invalid/unconfigured values do nothing |
| `receivedServoAngle(target)` | Numeric value from the last matching command; -1 if invalid/unrelated |
| `isServoCommand(target)` | Condition checking a valid matching command, including angle zero |
| `executeServerCommand()` | Put inside the server-message event; execute the supported command and send a v1 ACK |
| `protocolCommandId()` | Extract v1 command ID, or empty string for raw commands |
| `protocolCommandText()` | Extract literal payload while preserving case/spaces/colons |
| `acknowledgeCommand(id)` | Send success after a custom operation finishes |
| `rejectCommand(id, code)` | Send error; uppercase letters/digits/underscore, 1–48 characters |
| `sendSensor(key, value)` | Send numeric `DATA:key:value` telemetry |

## Accepted commands

| Command payload | Action |
|---|---|
| `CMD:servo:134` | Set configured Servo pin to 134 degrees |
| `CMD:valve:45` | Set configured Valve pin to 45 degrees |
| `CMD:mouth:90` | Set configured Mouth pin to 90 degrees |
| `a` | Display lowercase a on the LEDs |

The handler accepts both raw commands and v1 envelopes:

```text
CMD:servo:134                       → apply PWM, no ACK (legacy)
V1:CMD:servo-001:CMD:servo:134       → apply PWM, then V1:ACK:servo-001:OK
V1:CMD:bad-001:CMD:servo:181         → V1:ACK:bad-001:ERR:INVALID_ANGLE
```

Angles must contain 1–3 digits and be within 0–180. Negative/fractional/malformed angles are rejected; an unconfigured target returns `SERVO_NOT_CONFIGURED`. Other commands return `UNSUPPORTED_COMMAND`. Existing ESP32 motor blocks send `MOTOR:*` directly; this handler does not claim v1 motor execution support.

For servo commands, OK means the controller applied the requested PWM setting using [MakeCode servoWritePin](https://makecode.microbit.org/reference/pins/servo-write-pin). It does not measure the actual shaft position. The example assumes a positional servo; continuous rotation servos interpret these values as speed/direction.

The last eight completed ACKs are cached, so repeated completed IDs do not execute again. The cache is held in RAM and is cleared by reboot. Custom command handlers should capture ID and payload before yielding, then send OK/ERR themselves; the received-message event alone never acknowledges an unexecuted operation.

## Validation

From the platform root, run `npm test`. Host tests check both extension copies, example type checking, UART settings, exact payload parsing, pin routing, valid/invalid angles, ACKs and duplicate suppression. A host test does not replace MakeCode target compilation and testing on your connected boards.

`start()` in this compatibility copy retains its existing 9600 default; use the explicit-baud example for current ESP32 firmware. The moved extension is in the repository-root `microbit/` folder.

## UART startup fix in 0.1.2

Repeated `start()` or `startWithBaudRate()` with the current baud rate no longer redirects serial, resets its receive buffer, or sends another MB_START. Startup sets its guard before the first pause, so concurrent MakeCode fibers wait for the same initialization. An explicit different baud rate still reconfigures UART; select the baud once during startup.

The extension now installs one internal receiver during UART initialization, so ESP32 STATUS messages are consumed even without a server-message block. Registering a user handler only replaces the user callback; it does not add another serial listener. STATUS updates never call the user server-message handler or issue CONNECT.

These fixes address possible UART reinitialization and duplicate-listener problems; they do not prove why a particular ESP32 disconnects. Keep `setupWiFiAndServer()` in startup code. It intentionally sends CONNECT each time it is called. The updated ESP32 firmware handles duplicate CONNECT without tearing down unchanged working Wi-Fi.

For isolation, compile/upload `examples/wifi-only-check.ts` with your actual network settings. It sends setup once and leaves servo, motor and telemetry inactive. Observe the ESP32 OLED and USB logs. If this stays connected but the full application fails, inspect the application's forever loops, startup blocks and receive handler.
