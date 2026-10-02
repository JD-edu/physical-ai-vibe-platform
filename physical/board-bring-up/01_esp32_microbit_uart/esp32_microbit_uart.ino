// micro:bit <-> ESP32 UART bring-up test
//
// micro:bit P14 (TX) -> ESP32 GPIO16 (RX2)
// micro:bit P15 (RX) <- ESP32 GPIO17 (TX2)
// micro:bit GND      -- ESP32 GND

const int MICROBIT_RX_PIN = 16;
const int MICROBIT_TX_PIN = 17;
const unsigned long DEBUG_BAUD = 115200;
const unsigned long MICROBIT_BAUD = 9600;

void setup() {
    // USB 연결: Arduino IDE 시리얼 모니터 디버깅용 UART0
    Serial.begin(DEBUG_BAUD);
    delay(300);

    // micro:bit 연결: 기존 최종 펌웨어와 같은 UART2 핀과 속도
    Serial2.begin(MICROBIT_BAUD, SERIAL_8N1,
                  MICROBIT_RX_PIN, MICROBIT_TX_PIN);
    Serial2.setTimeout(100);

    Serial.println();
    Serial.println("=== micro:bit <-> ESP32 UART test ===");
    Serial.println("Serial0 debug: 115200 bps");
    Serial.println("UART2: GPIO16(RX), GPIO17(TX), 115200 bps");
    Serial.println("Waiting for micro:bit PING...");
}

void loop() {
    if (Serial2.available() == 0) {
        delay(5);
        return;
    }

    String message = Serial2.readStringUntil('\n');
    message.trim();

    if (message.length() == 0) {
        return;
    }

    Serial.print("micro:bit -> ESP32: ");
    Serial.println(message);

    if (message == "PING") {
        Serial2.println("PONG");
        Serial.println("ESP32 -> micro:bit: PONG");
    } else {
        String reply = "ECHO:" + message;
        Serial2.println(reply);
        Serial.print("ESP32 -> micro:bit: ");
        Serial.println(reply);
    }
}
