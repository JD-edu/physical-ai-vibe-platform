#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

const int MICROBIT_RX_PIN = 16;
const int MICROBIT_TX_PIN = 17;
const unsigned long MICROBIT_BAUD = 115200;
const unsigned long DEBUG_BAUD = 115200;
const unsigned long WIFI_TIMEOUT_MS = 15000;

const int OLED_SDA_PIN = 21;
const int OLED_SCL_PIN = 22;
const int OLED_WIDTH = 128;
const int OLED_HEIGHT = 64;
const int OLED_RESET_PIN = -1;
const uint8_t OLED_ADDRESS = 0x3C;
const int OLED_LINE_LENGTH = 21;

Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, OLED_RESET_PIN);

String wifiSSID;
String wifiPassword;
String serverIP;
String serverStatus = "WAIT";
String serverToMicrobitData = "-";
String microbitToServerData = "-";
bool settingsReady = false;
bool oledAvailable = false;

String fitOLEDLine(const String& text) {
    if (text.length() <= OLED_LINE_LENGTH) return text;
    return text.substring(0, OLED_LINE_LENGTH);
}

void updateOLED() {
    if (!oledAvailable) return;

    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(1);
    display.setTextWrap(false);

    display.setCursor(0, 0);
    display.println(fitOLEDLine("SSID:" + wifiSSID));

    display.setCursor(0, 16);
    display.println(fitOLEDLine(serverIP + " " + serverStatus));

    display.setCursor(0, 32);
    display.println(fitOLEDLine("S>M:" + serverToMicrobitData));

    display.setCursor(0, 48);
    display.println(fitOLEDLine("M>S:" + microbitToServerData));

    unsigned long oledStartedAt = micros();
    display.display();
    unsigned long oledElapsedUs = micros() - oledStartedAt;

    Serial.print("OLED_MS:");
    Serial.println(oledElapsedUs / 1000.0, 3);
}

void setConnectionStatus(const String& status) {
    if (serverStatus == status) return;

    serverStatus = status;
    updateOLED();
}

void initializeOLED() {
    Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN);
    oledAvailable = display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS);

    if (!oledAvailable) {
        Serial.println("OLED initialization failed");
        return;
    }

    updateOLED();
}

bool connectWiFi() {
    if (wifiSSID.length() == 0 || serverIP.length() == 0) {
        Serial.println("Missing SSID or server IP");
        setConnectionStatus("NOCFG");
        return false;
    }

    // 최초 연결과 운전 중 재연결을 OLED에서 구분합니다.
    setConnectionStatus(settingsReady ? "RETRY" : "WIFI");

    Serial.print("Connecting to Wi-Fi");
    WiFi.mode(WIFI_STA);
    WiFi.begin(wifiSSID.c_str(), wifiPassword.c_str());

    unsigned long startedAt = millis();
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print('.');

        if (millis() - startedAt >= WIFI_TIMEOUT_MS) {
            Serial.println();
            Serial.println("Wi-Fi connection failed");
            setConnectionStatus("WFAIL");
            return false;
        }
    }

    Serial.println();
    Serial.print("Wi-Fi connected. ESP32 IP: ");
    Serial.println(WiFi.localIP());
    setConnectionStatus("READY");
    return true;
}

void exchangeNumberWithServer(const String& microbitData) {
    if (WiFi.status() != WL_CONNECTED && !connectWiFi()) return;

    microbitToServerData = microbitData;
    setConnectionStatus("SEND");

    WiFiClient client;
    HTTPClient http;
    String serverURL = "http://" + serverIP + ":5000/exchange";

    if (!http.begin(client, serverURL)) {
        Serial.println("HTTP begin failed");
        setConnectionStatus("HFAIL");
        return;
    }

    http.setConnectTimeout(3000);
    http.setTimeout(3000);
    http.addHeader("Content-Type", "text/plain");

    unsigned long httpStartedAt = micros();
    int responseCode = http.POST(microbitData);

    String serverData;
    if (responseCode == HTTP_CODE_OK) {
        serverData = http.getString();
        serverData.trim();
    }

    http.end();
    unsigned long httpElapsedUs = micros() - httpStartedAt;

    Serial.print("HTTP_MS:");
    Serial.println(httpElapsedUs / 1000.0, 3);

    Serial.print("POST ");
    Serial.print(microbitData);
    Serial.print(" -> HTTP ");
    Serial.println(responseCode);

    if (responseCode == HTTP_CODE_OK) {
        if (serverData.length() > 0) {
            // micro:bit 확장의 NewLine 수신 방식에 맞춰 전체 문자열을 보냅니다.
            Serial2.println(serverData);
            serverToMicrobitData = serverData;
            setConnectionStatus("OK");

            Serial.print("Server -> micro:bit: ");
            Serial.println(serverData);
        } else {
            Serial.println("Empty server response ignored");
            setConnectionStatus("EMPTY");
        }
    } else {
        setConnectionStatus("HFAIL");
    }
}

void processMicrobitLine(String line) {
    line.trim();
    if (line.length() == 0) return;

    if (line.startsWith("SSID:")) {
        wifiSSID = line.substring(5);
        wifiSSID.trim();
        settingsReady = false;
        serverStatus = "WAIT";
        updateOLED();
        Serial.print("SSID received: ");
        Serial.println(wifiSSID);
        return;
    }

    if (line.startsWith("PASSWORD:")) {
        wifiPassword = line.substring(9);
        settingsReady = false;
        Serial.println("Password received");
        return;
    }

    if (line.startsWith("SERVER_IP:")) {
        serverIP = line.substring(10);
        serverIP.trim();
        settingsReady = false;
        serverStatus = "WAIT";
        updateOLED();
        Serial.print("Server IP received: ");
        Serial.println(serverIP);
        return;
    }

    if (line == "CONNECT") {
        settingsReady = connectWiFi();
        if (settingsReady) Serial.println("Ready to exchange numbers");
        return;
    }

    if (!settingsReady) {
        Serial.print("Ignored before CONNECT: ");
        Serial.println(line);
        return;
    }

    Serial.print("micro:bit -> ESP32: ");
    Serial.println(line);
    exchangeNumberWithServer(line);
}

void setup() {
    Serial.begin(DEBUG_BAUD);
    delay(300);

    initializeOLED();

    Serial2.begin(MICROBIT_BAUD, SERIAL_8N1,
                  MICROBIT_RX_PIN, MICROBIT_TX_PIN);
    Serial2.setTimeout(200);

    WiFi.mode(WIFI_OFF);
    Serial.println("Waiting for Wi-Fi settings from micro:bit...");
}

void loop() {
    /*if (Serial2.available() == 0) {
        delay(5);
        return;
    }

    String line = Serial2.readStringUntil('\n');
    processMicrobitLine(line);
    */
     while (Serial2.available() > 0) {
        String command = Serial2.readStringUntil('\n');
        processMicrobitLine(command);
    }
}
