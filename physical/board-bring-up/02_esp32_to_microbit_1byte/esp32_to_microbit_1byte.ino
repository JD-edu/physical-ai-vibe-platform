// Bring-up test 2: ESP32 -> micro:bit single-character UART transmission
//
// ESP32 GPIO17 (TX2) -> micro:bit P15 (RX)
// ESP32 GND          -- micro:bit GND
//
// Sends one ASCII digit ('0' through '9') followed by a newline every second.
// The newline lets the existing micro:bit read-until-newline code receive it.

const int MICROBIT_RX_PIN = 16;
const int MICROBIT_TX_PIN = 17;
const unsigned long DEBUG_BAUD = 115200;
const unsigned long MICROBIT_BAUD = 9600;
const unsigned long SEND_INTERVAL_MS = 1000;

char digitToSend = '0';
unsigned long lastSendTime = 0;

void setup() {
    // Arduino IDE Serial Monitor (UART0)
    Serial.begin(DEBUG_BAUD);

    // micro:bit UART (UART2)
    Serial2.begin(MICROBIT_BAUD, SERIAL_8N1,
                  MICROBIT_RX_PIN, MICROBIT_TX_PIN);

    Serial.println();
    Serial.println("=== ESP32 -> micro:bit character test ===");
    Serial.println("UART2 TX: GPIO17, 9600 bps");
    Serial.println("Sending ASCII digits 0 through 9...");

    // Allow time for the micro:bit to finish booting.
    delay(2000);
}

void loop() {
    unsigned long now = millis();

    if (now - lastSendTime < SEND_INTERVAL_MS) {
        return;
    }
    lastSendTime = now;

    // Send one character followed by CR+LF for readUntil(NewLine) on micro:bit.
    Serial2.println(digitToSend);

    Serial.print("Sent line: '");
    Serial.print(digitToSend);
    Serial.print("' (0x");
    Serial.print(static_cast<uint8_t>(digitToSend), HEX);
    Serial.println(")");

    digitToSend++;
    if (digitToSend > '9') {
        digitToSend = '0';
    }
}
