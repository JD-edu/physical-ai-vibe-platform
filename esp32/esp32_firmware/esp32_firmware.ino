#include <WiFi.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <esp_arduino_version.h>
#include <esp_system.h>
#include "esp32_wifi_protocol.h"

// ==================== OLED ====================
const int OLED_SDA_PIN = 21;
const int OLED_SCL_PIN = 22;
const int OLED_WIDTH = 128;
const int OLED_HEIGHT = 64;
const int OLED_RESET_PIN = -1;
const uint8_t OLED_ADDRESS = 0x3C;

Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, OLED_RESET_PIN);
bool oledAvailable = false;

// ==================== 서버 ====================
const char* DEFAULT_SERVER_IP = "192.168.0.81";
const int HTTP_PORT = 5000;
const char* RECEIVE_PATH = "/receive";
const int COMMAND_PORT = 5001;

// ==================== TB6612FNG 모터 ====================
// 회로도 기준
// STBY  -> GPIO5
// PWMA  -> GPIO12
// PWMB  -> GPIO13
// AIN1  -> GPIO14
// AIN2  -> GPIO15
// BIN1  -> GPIO18
// BIN2  -> GPIO19
const int MOTOR_STBY_PIN = 5;
const int MOTOR1_PWM_PIN = 12;
const int MOTOR2_PWM_PIN = 13;
const int MOTOR1_IN1_PIN = 14;
const int MOTOR1_IN2_PIN = 15;
const int MOTOR2_IN1_PIN = 18;
const int MOTOR2_IN2_PIN = 19;

const int MOTOR_PWM_FREQ = 20000;   // 20 kHz
const int MOTOR_PWM_RESOLUTION = 8; // 0~255
const int MOTOR1_PWM_CHANNEL = 0;
const int MOTOR2_PWM_CHANNEL = 1;

// ==================== 서보 출력 ====================
// 사용하는 액추에이터에 맞춰 핀을 변경하세요. 전원은 ESP32와 별도로 공급하고 GND를 공유합니다.
const int SERVO_PIN = 25;
const int VALVE_PIN = 26;
const int MOUTH_PIN = 27;
const int SERVO_PWM_FREQ = 50;
const int SERVO_PWM_RESOLUTION = 16;
const int SERVO_CHANNELS[] = {2, 3, 4};
const int SERVO_PINS[] = {SERVO_PIN, VALVE_PIN, MOUTH_PIN};


// ==================== 객체/설정 ====================
Preferences preferences;
WiFiClient commandClient;
String commandReceiveBuffer;
bool discardCommandLine = false;
String usbLine;
bool discardUsbLine = false;

String wifiSSID = "";
String wifiPassword = "";
String serverIP = DEFAULT_SERVER_IP;

// Remember the credentials applied to the active station connection.
String activeWiFiSSID = "";
String activeWiFiPassword = "";

bool connectionEnabled = false;
bool savedSettings = false;
String provisionState = "needs_setup";

unsigned long lastWiFiReconnect = 0;
unsigned long lastServerReconnect = 0;
const unsigned long WIFI_RECONNECT_INTERVAL = 5000;
const unsigned long SERVER_RECONNECT_INTERVAL = 3000;

// Latest bridge traffic only; keep each row bounded for the 21-character display.
// TX = ESP32 -> bridge (HTTP telemetry / TCP greeting), RX = bridge -> ESP32.
String oledTxLine = "TX: (none)";
String oledRxLine = "RX: (none)";

// ==================== OLED 보조 함수 ====================
String shortenText(const String& text, int maxLength) {
    if (text.length() <= maxLength) return text;
    if (maxLength <= 3) return text.substring(0, maxLength);
    return text.substring(0, maxLength - 3) + "...";
}

void showOLEDMessage(const String& line1,
                     const String& line2 = "",
                     const String& line3 = "",
                     const String& line4 = "") {
    if (!oledAvailable) return;

    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(1);
    display.setTextWrap(false);

    display.setCursor(0, 0);  display.println(shortenText(line1, 21));
    display.setCursor(0, 16); display.println(shortenText(line2, 21));
    // Reserve the bottom two rows for traffic while the bridge link is active,
    // including when repeated setup/status commands update the top rows.
    const bool bridgeConnected = connectionEnabled && WiFi.status() == WL_CONNECTED && commandClient.connected();
    display.setCursor(0, 32); display.println(shortenText(bridgeConnected ? oledTxLine : line3, 21));
    display.setCursor(0, 48); display.println(shortenText(bridgeConnected ? oledRxLine : line4, 21));
    display.display();
}

void showBridgeTraffic() {
    if (!connectionEnabled || WiFi.status() != WL_CONNECTED || !commandClient.connected()) return;
    showOLEDMessage("SERVER: CONNECTED", serverIP + ":" + String(COMMAND_PORT));
}

void recordBridgeTx(const String& data, const String& result) {
    oledTxLine = shortenText("TX[" + result + "]:" + data, 21);
    showBridgeTraffic();
}

String makeDots(int count) {
    String result = "";
    for (int i = 0; i < count; i++) result += ".";
    return result;
}

void initializeOLED() {
    Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN);
    if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS)) {
        oledAvailable = false;
        Serial.println("OLED initialization failed");
        return;
    }

    oledAvailable = true;
    showOLEDMessage("ESP32 Controller", "BOOTING", "Loading settings");
}

String jsonString(const String& text) {
    String output = "\"";
    for (size_t i = 0; i < text.length(); ++i) {
        const unsigned char c = text[i];
        if (c == '"' || c == '\\') { output += '\\'; output += char(c); }
        else if (c < 32) {
            char escaped[7]; snprintf(escaped, sizeof(escaped), "\\u%04x", unsigned(c)); output += escaped;
        } else output += char(c);
    }
    return output + "\"";
}

void reportProvisionStatus(const char *state = nullptr) {
    const String current = state ? String(state) : provisionState;
    const String ip = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "";
    Serial.println("ESP32_WIFI {\"device\":\"phyvibe-control\",\"protocol\":1,\"state\":" + jsonString(current) +
                   ",\"ssid\":" + jsonString(wifiSSID) + ",\"server_ip\":" + jsonString(serverIP) +
                   ",\"stored\":" + (savedSettings ? "true" : "false") + ",\"ip\":" + jsonString(ip) + "}");
}

void sendStatus(const String& status) {
    Serial.println("STATUS:" + status);
    if (status == "WIFI_CONNECTING" || status == "WIFI_RECONNECTING" || status == "SERVER_CONNECTING" ||
        status == "WIFI_CONNECTED") provisionState = "connecting";
    else if (status == "WIFI_FAILED") provisionState = "wifi_failed";
    else if (status == "SERVER_FAILED") provisionState = "server_failed";
    else if (status == "SERVER_CONNECTED") provisionState = "connected";
    else if (status == "DISCONNECTED") provisionState = "disconnected";
    else if (status == "SETTINGS_CLEARED") provisionState = "needs_setup";
    else return;
    reportProvisionStatus();
}

// ==================== 설정 저장/읽기 ====================
bool isValidServerIP(const String& ipText) {
    IPAddress parsedIP;
    return parsedIP.fromString(ipText);
}

void loadSettingsOnly() {
    esp32_wifi::Settings stored;
    if (preferences.begin("phyctl", true)) {
        const bool found = preferences.getBytesLength("settings") == sizeof(stored) &&
                           preferences.getBytes("settings", &stored, sizeof(stored)) == sizeof(stored) &&
                           esp32_wifi::validSettings(stored);
        preferences.end();
        if (found) {
            wifiSSID = stored.ssid; wifiPassword = stored.password; serverIP = stored.serverIp;
            savedSettings = true; provisionState = "connecting";
            Serial.println("Settings loaded");
            return;
        }
    }
    // Migrate credentials saved by the previous USB Serial Monitor workflow.
    preferences.begin("wifi", true);
    wifiSSID = preferences.getString("ssid", "");
    wifiPassword = preferences.getString("password", "");
    preferences.end();

    preferences.begin("server", true);
    serverIP = preferences.getString("ip", DEFAULT_SERVER_IP);
    preferences.end();

    if (!isValidServerIP(serverIP)) serverIP = DEFAULT_SERVER_IP;

    savedSettings = wifiSSID.length() > 0;
    provisionState = savedSettings ? "connecting" : "needs_setup";

    Serial.println("Settings loaded");
}

bool saveSettings() {
    esp32_wifi::Settings settings;
    if (wifiSSID.length() > 32 || wifiPassword.length() > 63 || serverIP.length() > 15) return false;
    wifiSSID.toCharArray(settings.ssid, sizeof(settings.ssid));
    wifiPassword.toCharArray(settings.password, sizeof(settings.password));
    serverIP.toCharArray(settings.serverIp, sizeof(settings.serverIp));
    if (!esp32_wifi::validSettings(settings) || !preferences.begin("phyctl", false)) return false;
    const bool stored = preferences.putBytes("settings", &settings, sizeof(settings)) == sizeof(settings);
    preferences.end();
    if (stored) savedSettings = true;
    return stored;
}

// ==================== 연결 처리 ====================
bool connectWiFi() {
    if (!connectionEnabled) return false;

    if (wifiSSID.length() == 0) {
        showOLEDMessage("WiFi ERROR", "SSID is empty", "Send SSID first");
        sendStatus("WIFI_NO_SSID");
        return false;
    }

    // Repeated CONNECT with unchanged credentials must not tear down a working link.
    if (WiFi.status() == WL_CONNECTED && activeWiFiSSID == wifiSSID &&
        activeWiFiPassword == wifiPassword) {
        sendStatus("WIFI_ALREADY_CONNECTED");
        return true;
    }

    commandClient.stop();
    WiFi.mode(WIFI_STA);
    // This firmware owns retry timing. Do not race the core's automatic reconnect.
    WiFi.setAutoReconnect(false);
    WiFi.disconnect(false);
    delay(200);
    activeWiFiSSID = wifiSSID;
    activeWiFiPassword = wifiPassword;

    showOLEDMessage("WiFi CONNECTING", "SSID:", wifiSSID, "Please wait...");
    sendStatus("WIFI_CONNECTING");

    WiFi.begin(wifiSSID.c_str(), wifiPassword.c_str());
    unsigned long startedAt = millis();
    int dots = 0;

    while (WiFi.status() != WL_CONNECTED) {
        delay(400);
        dots = (dots + 1) % 11;
        showOLEDMessage("WiFi CONNECTING", shortenText(wifiSSID, 21), makeDots(dots), "Timeout: 20 sec");

        if (millis() - startedAt >= 20000) {
            showOLEDMessage("WiFi FAILED", "SSID:", wifiSSID, "Wait/retry");
            sendStatus("WIFI_FAILED");
            lastWiFiReconnect = millis();
            return false;
        }
    }

    showOLEDMessage("WiFi CONNECTED", "SSID:" + shortenText(WiFi.SSID(), 16),
                    "IP:" + WiFi.localIP().toString(), "Server: waiting");
    sendStatus("WIFI_CONNECTED");
    lastWiFiReconnect = millis();
    return true;
}

bool connectCommandServer() {
    if (!connectionEnabled || WiFi.status() != WL_CONNECTED) return false;
    if (commandClient.connected()) return true;

    showOLEDMessage("SERVER CONNECTING", serverIP + ":" + String(COMMAND_PORT),
                    "WiFi IP:", WiFi.localIP().toString());
    sendStatus("SERVER_CONNECTING");

    lastServerReconnect = millis();
    commandClient.stop();
    commandReceiveBuffer = "";
    discardCommandLine = false;
    if (!commandClient.connect(serverIP.c_str(), COMMAND_PORT)) {
        showOLEDMessage("SERVER OFFLINE", serverIP + ":" + String(COMMAND_PORT),
                        "WiFi connected", "Retry after 3 sec");
        sendStatus("SERVER_FAILED");
        return false;
    }

    // Start a fresh traffic view for this connection; do not show stale RX data.
    oledRxLine = "RX: (none)";
    // Negotiate bridge link monitoring. This is not a motor execution ACK.
    commandClient.println("PHYVIBE_LINK_HELLO:" + WiFi.macAddress());
    const size_t greetingBytes = commandClient.println("ESP32_CONNECTED");
    recordBridgeTx("ESP32_CONNECTED", greetingBytes == 17 ? "TCP" : "ERR");
    sendStatus("SERVER_CONNECTED");
    return true;
}

void sendToServer(const String& data) {
    if (!connectionEnabled) {
        sendStatus("NOT_CONNECTED");
        return;
    }

    if (WiFi.status() != WL_CONNECTED) {
        sendStatus("WIFI_DISCONNECTED");
        return;
    }

    WiFiClient httpClient;
    HTTPClient http;
    String url = "http://" + serverIP + ":" + String(HTTP_PORT) + RECEIVE_PATH;

    if (!http.begin(httpClient, url)) {
        recordBridgeTx(data, "ERR");
        sendStatus("HTTP_BEGIN_FAILED");
        return;
    }

    http.setConnectTimeout(3000);
    http.setTimeout(3000);
    http.addHeader("Content-Type", "text/plain; charset=utf-8");
    int code = http.POST(data);
    http.end();

    // HTTP codes (including negative transport errors) describe this send attempt.
    recordBridgeTx(data, String(code));
    Serial.printf("HTTP telemetry status=%d\n", code);
    if (code >= 200 && code < 300) sendStatus("DATA_SENT");
    else sendStatus("DATA_SEND_FAILED");
}

// ==================== 모터 제어 ====================
void initializeMotors() {
    pinMode(MOTOR_STBY_PIN, OUTPUT);
    pinMode(MOTOR1_IN1_PIN, OUTPUT);
    pinMode(MOTOR1_IN2_PIN, OUTPUT);
    pinMode(MOTOR2_IN1_PIN, OUTPUT);
    pinMode(MOTOR2_IN2_PIN, OUTPUT);

#if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcAttachChannel(MOTOR1_PWM_PIN, MOTOR_PWM_FREQ, MOTOR_PWM_RESOLUTION, MOTOR1_PWM_CHANNEL);
    ledcAttachChannel(MOTOR2_PWM_PIN, MOTOR_PWM_FREQ, MOTOR_PWM_RESOLUTION, MOTOR2_PWM_CHANNEL);
#else
    ledcSetup(MOTOR1_PWM_CHANNEL, MOTOR_PWM_FREQ, MOTOR_PWM_RESOLUTION);
    ledcSetup(MOTOR2_PWM_CHANNEL, MOTOR_PWM_FREQ, MOTOR_PWM_RESOLUTION);
    ledcAttachPin(MOTOR1_PWM_PIN, MOTOR1_PWM_CHANNEL);
    ledcAttachPin(MOTOR2_PWM_PIN, MOTOR2_PWM_CHANNEL);
#endif

    // 부팅 시에는 반드시 정지 상태
    digitalWrite(MOTOR_STBY_PIN, LOW);
    digitalWrite(MOTOR1_IN1_PIN, LOW);
    digitalWrite(MOTOR1_IN2_PIN, LOW);
    digitalWrite(MOTOR2_IN1_PIN, LOW);
    digitalWrite(MOTOR2_IN2_PIN, LOW);

#if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcWriteChannel(MOTOR1_PWM_CHANNEL, 0);
    ledcWriteChannel(MOTOR2_PWM_CHANNEL, 0);
#else
    ledcWrite(MOTOR1_PWM_CHANNEL, 0);
    ledcWrite(MOTOR2_PWM_CHANNEL, 0);
#endif
}

void writeMotorPWM(int motorNumber, int duty) {
    duty = constrain(duty, 0, 255);

#if ESP_ARDUINO_VERSION_MAJOR >= 3
    if (motorNumber == 1) {
        ledcWriteChannel(MOTOR1_PWM_CHANNEL, duty);
    } else if (motorNumber == 2) {
        ledcWriteChannel(MOTOR2_PWM_CHANNEL, duty);
    }
#else
    if (motorNumber == 1) {
        ledcWrite(MOTOR1_PWM_CHANNEL, duty);
    } else if (motorNumber == 2) {
        ledcWrite(MOTOR2_PWM_CHANNEL, duty);
    }
#endif
}

// speed: -100 ~ +100
// + : IN1=HIGH, IN2=LOW
// - : IN1=LOW,  IN2=HIGH
void setMotorSpeed(int motorNumber, int speed) {
    speed = constrain(speed, -100, 100);

    int in1Pin;
    int in2Pin;

    if (motorNumber == 1) {
        in1Pin = MOTOR1_IN1_PIN;
        in2Pin = MOTOR1_IN2_PIN;
    } else if (motorNumber == 2) {
        in1Pin = MOTOR2_IN1_PIN;
        in2Pin = MOTOR2_IN2_PIN;
    } else {
        return;
    }

    if (speed == 0) {
        digitalWrite(in1Pin, LOW);
        digitalWrite(in2Pin, LOW);
        writeMotorPWM(motorNumber, 0);
        return;
    }

    digitalWrite(MOTOR_STBY_PIN, HIGH);

    if (speed > 0) {
        digitalWrite(in1Pin, HIGH);
        digitalWrite(in2Pin, LOW);
    } else {
        digitalWrite(in1Pin, LOW);
        digitalWrite(in2Pin, HIGH);
    }

    int duty = map(abs(speed), 0, 100, 0, 255);
    writeMotorPWM(motorNumber, duty);
}

void stopAllMotors() {
    writeMotorPWM(1, 0);
    writeMotorPWM(2, 0);

    digitalWrite(MOTOR1_IN1_PIN, LOW);
    digitalWrite(MOTOR1_IN2_PIN, LOW);
    digitalWrite(MOTOR2_IN1_PIN, LOW);
    digitalWrite(MOTOR2_IN2_PIN, LOW);

    // 두 모터가 모두 멈춘 뒤 드라이버를 Standby
    digitalWrite(MOTOR_STBY_PIN, LOW);
}

// ==================== ESP32 직접 명령 ====================
void initializeServos() {
    for (int i = 0; i < 3; i++) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
        ledcAttachChannel(SERVO_PINS[i], SERVO_PWM_FREQ, SERVO_PWM_RESOLUTION, SERVO_CHANNELS[i]);
#else
        ledcSetup(SERVO_CHANNELS[i], SERVO_PWM_FREQ, SERVO_PWM_RESOLUTION);
        ledcAttachPin(SERVO_PINS[i], SERVO_CHANNELS[i]);
#endif
    }
}

void setServoAngle(int index, int angle) {
    // 50 Hz period = 20,000 us; 500..2,500 us maps to 0..180 degrees.
    const uint32_t pulseUs = 500 + (uint32_t(angle) * 2000) / 180;
    const uint32_t duty = pulseUs * 65535UL / 20000UL;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcWriteChannel(SERVO_CHANNELS[index], duty);
#else
    ledcWrite(SERVO_CHANNELS[index], duty);
#endif
}

bool parseNumber(const String& text, int minValue, int maxValue, int& result) {
    if (text.length() == 0) return false;
    size_t start = text[0] == '-' ? 1 : 0;
    if (start == text.length()) return false;
    for (size_t i = start; i < text.length(); i++) if (!isDigit(text[i])) return false;
    const long value = text.toInt();
    if (value < minValue || value > maxValue) return false;
    result = int(value);
    return true;
}

bool processDeviceCommand(const String& command) {
    if (command.startsWith("CMD:motor:")) {
        String rest = command.substring(10);
        const int separator = rest.indexOf(':');
        String direction = separator >= 0 ? rest.substring(0, separator) : "forward";
        String speedText = separator >= 0 ? rest.substring(separator + 1) : rest;
        int speed;
        if (!parseNumber(speedText, 0, 80, speed)) return false;
        if (direction != "forward" && direction != "backward" && direction != "left" &&
            direction != "right" && direction != "stop") return false;
        if (direction == "stop" || speed == 0) stopAllMotors();
        else if (direction == "forward") { setMotorSpeed(1, speed); setMotorSpeed(2, speed); }
        else if (direction == "backward") { setMotorSpeed(1, -speed); setMotorSpeed(2, -speed); }
        else if (direction == "left") { setMotorSpeed(1, -speed); setMotorSpeed(2, speed); }
        else if (direction == "right") { setMotorSpeed(1, speed); setMotorSpeed(2, -speed); }
        else return false;
        sendStatus("MOTOR_COMMAND_APPLIED");
        return true;
    }
    if (command.startsWith("MOT:")) {
        const String values = command.substring(4);
        const int separator = values.indexOf(':');
        if (separator < 0) return false;
        int left, right;
        if (!parseNumber(values.substring(0, separator), -255, 255, left) ||
            !parseNumber(values.substring(separator + 1), -255, 255, right)) return false;
        if (left == 0 && right == 0) stopAllMotors();
        else { setMotorSpeed(1, map(left, -255, 255, -100, 100));
               setMotorSpeed(2, map(right, -255, 255, -100, 100)); }
        sendStatus("MOTOR_COMMAND_APPLIED");
        return true;
    }
    if (command.startsWith("CMD:servo:") || command.startsWith("CMD:valve:") ||
        command.startsWith("CMD:mouth:")) {
        const int separator = command.lastIndexOf(':');
        int angle;
        if (!parseNumber(command.substring(separator + 1), 0, 180, angle)) return false;
        const int index = command.startsWith("CMD:servo:") ? 0 :
                          command.startsWith("CMD:valve:") ? 1 : 2;
        setServoAngle(index, angle);
        sendStatus("SERVO_COMMAND_APPLIED");
        return true;
    }
    return false;
}

// USB 시리얼 모니터에서 115200 baud, 줄바꿈으로 초기 네트워크 설정.
void processUsbCommand(String command) {
    if (command.endsWith("\r")) command.remove(command.length() - 1);
    if (command == "ESP32_WIFI_STATUS") { reportProvisionStatus(); return; }
    if (command.startsWith("ESP32_WIFI_SET ")) {
        esp32_wifi::Settings next;
        if (!esp32_wifi::parseSettings(command.c_str(), next)) { reportProvisionStatus("invalid_settings"); return; }
        const String oldSsid = wifiSSID, oldPassword = wifiPassword, oldServerIp = serverIP;
        wifiSSID = next.ssid; wifiPassword = next.password; serverIP = next.serverIp;
        if (!saveSettings()) {
            wifiSSID = oldSsid; wifiPassword = oldPassword; serverIP = oldServerIp;
            reportProvisionStatus("storage_error"); return;
        }
        stopAllMotors();
        commandClient.stop();
        connectionEnabled = true;
        provisionState = "connecting";
        reportProvisionStatus();
        if (connectWiFi()) connectCommandServer();
        return;
    }
    if (command.startsWith("PASSWORD:")) { wifiPassword = command.substring(9); sendStatus("PASSWORD_RECEIVED"); return; }
    command.trim();
    if (command.length() == 0) return;
    Serial.println("USB -> " + command);
    if (command.startsWith("SSID:")) { wifiSSID = command.substring(5); wifiSSID.trim(); sendStatus("SSID_RECEIVED"); return; }
    if (command.startsWith("SERVER_IP:")) {
        String next = command.substring(10); next.trim();
        if (!isValidServerIP(next)) { sendStatus("INVALID_SERVER_IP"); return; }
        if (serverIP != next) commandClient.stop();
        serverIP = next; sendStatus("SERVER_IP_RECEIVED"); return;
    }
    if (command == "CONNECT") {
        if (wifiSSID.length() == 0) { sendStatus("WIFI_NO_SSID"); return; }
        if (!saveSettings()) { reportProvisionStatus("storage_error"); return; }
        connectionEnabled = true;
        if (connectWiFi()) connectCommandServer();
        return;
    }
    if (command == "DISCONNECT" || command == "CLEAR") {
        stopAllMotors(); connectionEnabled = false; commandClient.stop();
        WiFi.disconnect(true); WiFi.mode(WIFI_OFF);
        if (command == "CLEAR") {
            preferences.begin("phyctl", false); preferences.clear(); preferences.end();
            preferences.begin("wifi", false); preferences.clear(); preferences.end();
            preferences.begin("server", false); preferences.clear(); preferences.end();
            wifiSSID = ""; wifiPassword = ""; serverIP = DEFAULT_SERVER_IP; savedSettings = false;
        }
        sendStatus(command == "CLEAR" ? "SETTINGS_CLEARED" : "DISCONNECTED");
        return;
    }
    if (!processDeviceCommand(command)) sendStatus("UNKNOWN_COMMAND");
}

void checkUsbSerial() {
    while (Serial.available() > 0) {
        const char c = char(Serial.read());
        if (c == '\r') continue;
        if (c == '\n') {
            if (discardUsbLine) reportProvisionStatus("invalid_settings");
            else if (usbLine.length()) processUsbCommand(usbLine);
            usbLine = ""; discardUsbLine = false;
        } else if (!discardUsbLine) {
            if (usbLine.length() >= 512) { usbLine = ""; discardUsbLine = true; }
            else usbLine += c;
        }
    }
}

void handleServerLine(String command) {
    if (command.endsWith("\r")) command.remove(command.length() - 1);
    // Link probes terminate here and never reach the motor or servo outputs.
    if (command.startsWith("PHYVIBE_LINK_PING:")) {
        const String token = command.substring(18);
        if (token.length() > 0 && token.length() <= 32) commandClient.println("PHYVIBE_LINK_PONG:" + token);
        return;
    }
    if (command.startsWith("PHYVIBE_LINK_")) return;
    if (command.length() > 0) {
        oledRxLine = shortenText("RX:" + command, 21);
        showBridgeTraffic();
        Serial.println("Bridge -> ESP32: " + command);
        if (!processDeviceCommand(command)) Serial.println("Unsupported device command: " + command);
    }
}

void checkServerCommand() {
    if (!connectionEnabled || !commandClient.connected()) return;
    // Preserve fragmented TCP lines across loop iterations instead of processing
    // an incomplete ping/command after a readStringUntil timeout.
    while (commandClient.available() > 0) {
        const char c = char(commandClient.read());
        if (c == '\n') {
            if (!discardCommandLine) handleServerLine(commandReceiveBuffer);
            commandReceiveBuffer = ""; discardCommandLine = false;
        } else if (!discardCommandLine) {
            if (commandReceiveBuffer.length() >= 1025) {
                commandReceiveBuffer = ""; discardCommandLine = true;
                Serial.println("Bridge command line too long; ignored");
            } else commandReceiveBuffer += c;
        }
    }
}

void maintainConnections() {
    // USB에서 DISCONNECT를 받았다면 재연결하지 않음
    if (!connectionEnabled) return;

    static bool linkWasOnline = false;
    const bool linkOnline = WiFi.status() == WL_CONNECTED && commandClient.connected();
    if (linkWasOnline && !linkOnline) {
        stopAllMotors();
        sendStatus("MOTOR_STOPPED_LINK_LOST");
    }
    linkWasOnline = linkOnline;

    if (WiFi.status() != WL_CONNECTED) {
        if (millis() - lastWiFiReconnect >= WIFI_RECONNECT_INTERVAL) {
            lastWiFiReconnect = millis();
            showOLEDMessage("WiFi RECONNECT", wifiSSID, "Please wait...");
            sendStatus("WIFI_RECONNECTING");
            // Give each attempt the full 20-second association/DHCP window.
            // connectWiFi records its completion time before the next 5-second retry.
            if (connectWiFi()) connectCommandServer();
        }
        return;
    }

    if (!commandClient.connected() &&
        millis() - lastServerReconnect >= SERVER_RECONNECT_INTERVAL) {
        lastServerReconnect = millis();
        connectCommandServer();
    }
}

void setup() {
    Serial.begin(115200);
    delay(200);
    Serial.printf("BOOT reset_reason=%d\n", static_cast<int>(esp_reset_reason()));
    WiFi.onEvent([](WiFiEvent_t event, WiFiEventInfo_t info) {
        // Wi-Fi event callbacks run on another task: only use thread-safe Serial logging.
        if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
            Serial.printf("WIFI_EVENT disconnected reason=%u\n", info.wifi_sta_disconnected.reason);
        } else if (event == ARDUINO_EVENT_WIFI_STA_GOT_IP) {
            Serial.println("WIFI_EVENT got IP");
        }
    });

    initializeOLED();
    initializeMotors();
    initializeServos();

    Serial.setTimeout(100);

    loadSettingsOnly();
    reportProvisionStatus();

    connectionEnabled = wifiSSID.length() > 0;
    if (connectionEnabled) {
        if (connectWiFi()) connectCommandServer();
    } else showOLEDMessage("ESP32 WAITING", "USB settings needed", "SSID/PASSWORD/IP", "then CONNECT");
}

void loop() {
    checkUsbSerial();
    checkServerCommand();
    maintainConnections();
    delay(5);
}
