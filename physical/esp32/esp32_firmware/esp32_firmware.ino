#include <WiFi.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <esp_arduino_version.h>

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

// ==================== micro:bit UART ====================
const int RX2_PIN = 16;
const int TX2_PIN = 17;
const int MICROBIT_BAUD = 9600;

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


// ==================== 객체/설정 ====================
Preferences preferences;
WiFiClient commandClient;

String wifiSSID = "";
String wifiPassword = "";
String serverIP = DEFAULT_SERVER_IP;

// CONNECT 명령 전에는 절대로 네트워크 연결을 시도하지 않음
bool microbitStarted = false;
bool connectionEnabled = false;

unsigned long lastWiFiReconnect = 0;
unsigned long lastServerReconnect = 0;
const unsigned long WIFI_RECONNECT_INTERVAL = 5000;
const unsigned long SERVER_RECONNECT_INTERVAL = 3000;

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
    display.setCursor(0, 32); display.println(shortenText(line3, 21));
    display.setCursor(0, 48); display.println(shortenText(line4, 21));
    display.display();
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
    showOLEDMessage("ESP32 WiFi Bridge", "BOOTING", "Network disabled", "Wait micro:bit");
}

void sendStatus(const String& status) {
    Serial2.println("STATUS:" + status);
    Serial.println("STATUS:" + status);
}

// ==================== 설정 저장/읽기 ====================
bool isValidServerIP(const String& ipText) {
    IPAddress parsedIP;
    return parsedIP.fromString(ipText);
}

void loadSettingsOnly() {
    preferences.begin("wifi", true);
    wifiSSID = preferences.getString("ssid", "");
    wifiPassword = preferences.getString("password", "");
    preferences.end();

    preferences.begin("server", true);
    serverIP = preferences.getString("ip", DEFAULT_SERVER_IP);
    preferences.end();

    if (!isValidServerIP(serverIP)) serverIP = DEFAULT_SERVER_IP;

    // 중요: 설정은 읽지만 Wi-Fi.begin()은 호출하지 않음
    Serial.println("Settings loaded, network remains disabled");
}

void saveSettings() {
    preferences.begin("wifi", false);
    preferences.putString("ssid", wifiSSID);
    preferences.putString("password", wifiPassword);
    preferences.end();

    preferences.begin("server", false);
    preferences.putString("ip", serverIP);
    preferences.end();
}

// ==================== 연결 처리 ====================
bool connectWiFi() {
    if (!connectionEnabled) return false;

    if (wifiSSID.length() == 0) {
        showOLEDMessage("WiFi ERROR", "SSID is empty", "Send SSID first");
        sendStatus("WIFI_NO_SSID");
        return false;
    }

    commandClient.stop();
    WiFi.disconnect(true);
    delay(200);
    WiFi.mode(WIFI_STA);

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
            return false;
        }
    }

    showOLEDMessage("WiFi CONNECTED", "SSID:" + shortenText(WiFi.SSID(), 16),
                    "IP:" + WiFi.localIP().toString(), "Server: waiting");
    sendStatus("WIFI_CONNECTED");
    return true;
}

bool connectCommandServer() {
    if (!connectionEnabled || WiFi.status() != WL_CONNECTED) return false;
    if (commandClient.connected()) return true;

    showOLEDMessage("SERVER CONNECTING", serverIP + ":" + String(COMMAND_PORT),
                    "WiFi IP:", WiFi.localIP().toString());
    sendStatus("SERVER_CONNECTING");

    commandClient.stop();
    if (!commandClient.connect(serverIP.c_str(), COMMAND_PORT)) {
        showOLEDMessage("SERVER OFFLINE", serverIP + ":" + String(COMMAND_PORT),
                        "WiFi connected", "Retry after 3 sec");
        sendStatus("SERVER_FAILED");
        return false;
    }

    commandClient.println("ESP32_CONNECTED");
    showOLEDMessage("SYSTEM READY", "SSID:" + shortenText(WiFi.SSID(), 16),
                    "IP:" + WiFi.localIP().toString(), "SERVER: CONNECTED");
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
        sendStatus("HTTP_BEGIN_FAILED");
        return;
    }

    http.setConnectTimeout(3000);
    http.setTimeout(3000);
    http.addHeader("Content-Type", "text/plain; charset=utf-8");
    int code = http.POST(data);
    http.end();

    if (code > 0) sendStatus("DATA_SENT");
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

// 형식:
// MOTOR:1:<speed>       예) MOTOR:1:80
// MOTOR:2:<speed>       예) MOTOR:2:-50
// MOTOR:BOTH:<m1>,<m2>  예) MOTOR:BOTH:80,80
// MOTOR:STOP
bool processMotorCommand(const String& command) {
    if (command == "MOTOR:STOP") {
        stopAllMotors();
        sendStatus("MOTOR_STOPPED");
        return true;
    }

    if (command.startsWith("MOTOR:1:")) {
        int speed = command.substring(8).toInt();
        speed = constrain(speed, -100, 100);
        setMotorSpeed(1, speed);
        sendStatus("MOTOR1:" + String(speed));
        return true;
    }

    if (command.startsWith("MOTOR:2:")) {
        int speed = command.substring(8).toInt();
        speed = constrain(speed, -100, 100);
        setMotorSpeed(2, speed);
        sendStatus("MOTOR2:" + String(speed));
        return true;
    }

    if (command.startsWith("MOTOR:BOTH:")) {
        String values = command.substring(11);
        int commaIndex = values.indexOf(',');

        if (commaIndex < 0) {
            sendStatus("MOTOR_COMMAND_ERROR");
            return true;
        }

        int speed1 = values.substring(0, commaIndex).toInt();
        int speed2 = values.substring(commaIndex + 1).toInt();

        speed1 = constrain(speed1, -100, 100);
        speed2 = constrain(speed2, -100, 100);

        setMotorSpeed(1, speed1);
        setMotorSpeed(2, speed2);

        sendStatus("MOTORS:" + String(speed1) + "," + String(speed2));
        return true;
    }

    return false;
}

// ==================== micro:bit 명령 ====================
void processMicrobitCommand(String command) {
    command.trim();
    if (command.length() == 0) return;

    Serial.println("micro:bit -> " + command);

    // 모터 명령은 Wi-Fi 연결 여부와 관계없이 즉시 처리
    if (processMotorCommand(command)) {
        return;
    }

    if (command == "MB_START") {
        microbitStarted = true;
        showOLEDMessage("micro:bit READY", "UART: 9600 bps", "Network disabled", "Send WiFi settings");
        sendStatus("ESP32_READY");
        return;
    }

    if (command.startsWith("SSID:")) {
        wifiSSID = command.substring(5);
        wifiSSID.trim();
        showOLEDMessage("SSID RECEIVED", wifiSSID, "Network disabled", "Wait PASSWORD");
        sendStatus("SSID_RECEIVED");
        return;
    }

    if (command.startsWith("PASSWORD:")) {
        wifiPassword = command.substring(9);
        showOLEDMessage("PASSWORD RECEIVED", "Network disabled", "Wait SERVER_IP", "or CONNECT");
        sendStatus("PASSWORD_RECEIVED");
        return;
    }

    if (command.startsWith("SERVER_IP:")) {
        String newIP = command.substring(10);
        newIP.trim();

        if (!isValidServerIP(newIP)) {
            showOLEDMessage("SERVER IP ERROR", newIP, "Invalid address");
            sendStatus("INVALID_SERVER_IP");
            return;
        }

        serverIP = newIP;
        showOLEDMessage("SERVER IP RECEIVED", serverIP, "Network disabled", "Send CONNECT");
        sendStatus("SERVER_IP_RECEIVED");
        return;
    }

    if (command == "CONNECT") {
        microbitStarted = true;
        connectionEnabled = true;
        saveSettings();

        showOLEDMessage("CONNECT COMMAND", "Settings saved", "Starting WiFi...", serverIP);
        sendStatus("CONNECT_ACCEPTED");

        if (connectWiFi()) connectCommandServer();
        return;
    }

    if (command == "DISCONNECT") {
        stopAllMotors();
        connectionEnabled = false;
        commandClient.stop();
        WiFi.disconnect(true);
        WiFi.mode(WIFI_OFF);
        showOLEDMessage("NETWORK STOPPED", "By micro:bit", "Wait CONNECT");
        sendStatus("DISCONNECTED");
        return;
    }

    if (command == "CLEAR") {
        stopAllMotors();
        connectionEnabled = false;
        commandClient.stop();
        WiFi.disconnect(true);
        WiFi.mode(WIFI_OFF);

        preferences.begin("wifi", false); preferences.clear(); preferences.end();
        preferences.begin("server", false); preferences.clear(); preferences.end();

        wifiSSID = "";
        wifiPassword = "";
        serverIP = DEFAULT_SERVER_IP;

        showOLEDMessage("SETTINGS CLEARED", "Network disabled", "Wait new settings");
        sendStatus("SETTINGS_CLEARED");
        return;
    }

    sendToServer(command);
}

void checkMicrobitSerial() {
    while (Serial2.available() > 0) {
        String command = Serial2.readStringUntil('\n');
        processMicrobitCommand(command);
    }
}

void checkServerCommand() {
    if (!connectionEnabled || !commandClient.connected()) return;

    while (commandClient.available() > 0) {
        String command = commandClient.readStringUntil('\n');
        command.trim();
        if (command.length() > 0) Serial2.println(command);
    }
}

void maintainConnections() {
    // CONNECT가 한 번도 오지 않았다면 아무 연결 작업도 하지 않음
    if (!connectionEnabled) return;

    if (WiFi.status() != WL_CONNECTED) {
        if (millis() - lastWiFiReconnect >= WIFI_RECONNECT_INTERVAL) {
            lastWiFiReconnect = millis();
            showOLEDMessage("WiFi RECONNECT", wifiSSID, "Please wait...");
            sendStatus("WIFI_RECONNECTING");
            WiFi.disconnect();
            WiFi.begin(wifiSSID.c_str(), wifiPassword.c_str());
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
    Serial.begin(9600);
    delay(200);

    initializeOLED();
    initializeMotors();

    Serial2.begin(MICROBIT_BAUD, SERIAL_8N1, RX2_PIN, TX2_PIN);
    Serial2.setTimeout(100);

    loadSettingsOnly();

    // ESP32 부팅 직후 Wi-Fi를 명시적으로 끔
    commandClient.stop();
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);

    showOLEDMessage("ESP32 WAITING", "UART ready: 9600", "WiFi: OFF", "Wait micro:bit");
}

void loop() {
    checkMicrobitSerial();
    checkServerCommand();
    maintainConnections();
    delay(5);
}