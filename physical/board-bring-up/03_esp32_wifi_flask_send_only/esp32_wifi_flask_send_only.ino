#include <WiFi.h>
#include <HTTPClient.h>

const int MICROBIT_RX_PIN = 16;
const int MICROBIT_TX_PIN = 17;
const unsigned long MICROBIT_BAUD = 9600;
const unsigned long DEBUG_BAUD = 115200;
const unsigned long WIFI_TIMEOUT_MS = 15000;

String wifiSSID;
String wifiPassword;
String serverIP;
bool settingsReady = false;

bool connectWiFi() {
    if (wifiSSID.length() == 0 || serverIP.length() == 0) {
        Serial.println("Missing SSID or server IP");
        return false;
    }

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
            return false;
        }
    }

    Serial.println();
    Serial.print("Wi-Fi connected. ESP32 IP: ");
    Serial.println(WiFi.localIP());
    return true;
}

void sendNumberToServer(const String& number) {
    if (WiFi.status() != WL_CONNECTED && !connectWiFi()) return;

    WiFiClient client;
    HTTPClient http;
    String serverURL = "http://" + serverIP + ":5000/send";

    if (!http.begin(client, serverURL)) {
        Serial.println("HTTP begin failed");
        return;
    }

    http.addHeader("Content-Type", "text/plain");
    int responseCode = http.POST(number);

    Serial.print("POST ");
    Serial.print(number);
    Serial.print(" -> HTTP ");
    Serial.println(responseCode);

    http.end();
}

void processMicrobitLine(String line) {
    line.trim();
    if (line.length() == 0) return;

    if (line.startsWith("SSID:")) {
        wifiSSID = line.substring(5);
        wifiSSID.trim();
        settingsReady = false;
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
        Serial.print("Server IP received: ");
        Serial.println(serverIP);
        return;
    }

    if (line == "CONNECT") {
        settingsReady = connectWiFi();
        if (settingsReady) Serial.println("Ready to forward numbers");
        return;
    }

    if (!settingsReady) {
        Serial.print("Ignored before CONNECT: ");
        Serial.println(line);
        return;
    }

    Serial.print("micro:bit -> ESP32: ");
    Serial.println(line);
    sendNumberToServer(line);
}

void setup() {
    Serial.begin(DEBUG_BAUD);
    delay(300);

    Serial2.begin(MICROBIT_BAUD, SERIAL_8N1,
                  MICROBIT_RX_PIN, MICROBIT_TX_PIN);
    Serial2.setTimeout(200);

    WiFi.mode(WIFI_OFF);
    Serial.println("Waiting for Wi-Fi settings from micro:bit...");
}

void loop() {
    if (Serial2.available() == 0) {
        delay(5);
        return;
    }

    String line = Serial2.readStringUntil('\n');
    processMicrobitLine(line);
}
