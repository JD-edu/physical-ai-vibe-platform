// Standalone LilyGO / TTGO T-Camera V1.6.2 (OV2640) Wi-Fi station streaming test.
// Camera pins: LilyGO official docs/T_CarmerV162.md.
#include <Arduino.h>
#include <WiFi.h>
#include <esp_camera.h>
#include <esp_http_server.h>
#include <esp_arduino_version.h>
#include <lwip/sockets.h>
#include <lwip/tcp.h>
#include <Preferences.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "camera_wifi_protocol.h"

// Optional initial credentials. Saved USB settings always take priority over these defaults.
const char *WIFI_SSID = "SK_WiFiGIGA73BA";
const char *WIFI_PASSWORD = "1609043407";

httpd_handle_t cameraServer = nullptr;
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
bool oledAvailable = false;
bool cameraReady = false;
bool savedSettings = false;
camera_wifi::Credentials wifiCredentials;
enum class WifiState { NeedsSetup, Connecting, Connected, Failed };
WifiState wifiState = WifiState::NeedsSetup;
unsigned long connectionStarted = 0;
constexpr unsigned long WIFI_TIMEOUT_MS = 20000;
// Favor a small current picture over high frame rate and queued old video.
constexpr unsigned long STREAM_FRAME_INTERVAL_MS = 125; // at most about 8 FPS
String serialLine;
bool discardSerialLine = false;

void showStatus(const String &line1, const String &line2 = "",
                const String &line3 = "", const String &line4 = "") {
    if (!oledAvailable) return;
    oled.clearDisplay();
    oled.setTextColor(SSD1306_WHITE);
    oled.setTextSize(1);
    oled.setTextWrap(false);
    oled.setCursor(0, 0); oled.println(line1.substring(0, 21));
    oled.setCursor(0, 16); oled.println(line2.substring(0, 21));
    oled.setCursor(0, 32); oled.println(line3.substring(0, 21));
    oled.setCursor(0, 48); oled.println(line4.substring(0, 21));
    oled.display();
}

String jsonString(const String &text) {
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

// Typed status contains the SSID and stream URL, never the password.
void reportWifiStatus(const char *overrideState = nullptr) {
    const char *state = overrideState;
    if (!state) {
        if (wifiState == WifiState::NeedsSetup) state = "needs_setup";
        else if (wifiState == WifiState::Connecting) state = "connecting";
        else if (wifiState == WifiState::Failed) state = "wifi_failed";
        else state = cameraReady && cameraServer ? "connected" : "camera_error";
    }
    const String ip = wifiState == WifiState::Connected ? WiFi.localIP().toString() : "";
    const String url = wifiState == WifiState::Connected && cameraReady && cameraServer ? "http://" + ip + "/stream" : "";
    Serial.println("CAMERA_WIFI {\"device\":\"phyvibe-camera\",\"protocol\":1,\"state\":" + jsonString(state) +
                   ",\"ssid\":" + jsonString(wifiCredentials.ssid) + ",\"stored\":" + (savedSettings ? "true" : "false") +
                   ",\"ip\":" + jsonString(ip) + ",\"url\":" + jsonString(url) + "}");
}

bool loadWifiSettings() {
    Preferences preferences;
    camera_wifi::Credentials fallback;
    // Compiled defaults are only a fallback: valid saved USB settings always win.
    if (strlen(WIFI_SSID) < sizeof(fallback.ssid) && strlen(WIFI_PASSWORD) < sizeof(fallback.password)) {
        strcpy(fallback.ssid, WIFI_SSID); strcpy(fallback.password, WIFI_PASSWORD);
    }
    return camera_wifi::loadCredentials(preferences, fallback, wifiCredentials, savedSettings);
}

bool saveWifiSettings(const camera_wifi::Credentials &value) {
    Preferences preferences;
    // One NVS blob updates SSID and password together; the previous pair cannot mix.
    return camera_wifi::saveCredentials(preferences, value);
}

void beginWifiConnection() {
    WiFi.disconnect(true, false);
    WiFi.persistent(false);
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(false);
    WiFi.setSleep(false);
    wifiState = WifiState::Connecting;
    connectionStarted = millis();
    WiFi.begin(wifiCredentials.ssid, wifiCredentials.password);
    showStatus("WiFi CONNECTING", wifiCredentials.ssid, "USB settings accepted", "Please wait...");
    reportWifiStatus();
}

void handleCameraSerial(const String &line) {
    if (line == "CAMERA_WIFI_STATUS") { reportWifiStatus(); return; }
    camera_wifi::Credentials next;
    if (!camera_wifi::parseSettings(line.c_str(), next)) { reportWifiStatus("invalid_settings"); return; }
    if (!saveWifiSettings(next)) {
        showStatus("WiFi SAVE FAILED", "Send settings again", "Bridge USB settings");
        reportWifiStatus("storage_error"); return;
    }
    // Always overwrite saved settings, even while the old SSID is connected.
    wifiCredentials = next;
    savedSettings = true;
    beginWifiConnection();
}

void checkCameraSerial() {
    while (Serial.available() > 0) {
        const char c = char(Serial.read());
        if (c == '\r') continue;
        if (c == '\n') {
            if (discardSerialLine) reportWifiStatus("invalid_settings");
            else if (serialLine.length()) handleCameraSerial(serialLine);
            serialLine = ""; discardSerialLine = false;
        } else if (!discardSerialLine) {
            if (serialLine.length() >= 512) { serialLine = ""; discardSerialLine = true; }
            else serialLine += c;
        }
    }
}

// Browser CNN reads pixels directly from this camera; no PC video relay.
void cameraCors(httpd_req_t *request) {
    httpd_resp_set_hdr(request, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_hdr(request, "Access-Control-Allow-Methods", "GET, OPTIONS");
    httpd_resp_set_hdr(request, "Access-Control-Allow-Headers", "Content-Type");
    httpd_resp_set_hdr(request, "Access-Control-Allow-Private-Network", "true");
}

esp_err_t cameraOptions(httpd_req_t *request) {
    cameraCors(request);
    httpd_resp_set_status(request, "204 No Content");
    return httpd_resp_send(request, nullptr, 0);
}

esp_err_t streamVideo(httpd_req_t *request) {
    cameraCors(request);
    httpd_resp_set_type(request, "multipart/x-mixed-replace; boundary=camera-frame");
    httpd_resp_set_hdr(request, "Cache-Control", "no-store");
    const int socket = httpd_req_to_sockfd(request);
    const int noDelay = 1;
    setsockopt(socket, IPPROTO_TCP, TCP_NODELAY, &noDelay, sizeof(noDelay));
    Serial.println("Video receiver connected: 320x240, latest-frame mode");
    unsigned long lastReport = millis();
    unsigned frames = 0;
    while (true) {
        const unsigned long frameStarted = millis();
        camera_fb_t *frame = esp_camera_fb_get();
        if (!frame) {
            Serial.println("ERROR: camera frame capture failed");
            return ESP_FAIL;
        }
        char header[128];
        int length = snprintf(header, sizeof(header),
            "\r\n--camera-frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n",
            static_cast<unsigned>(frame->len));
        esp_err_t result = httpd_resp_send_chunk(request, header, length);
        if (result == ESP_OK) {
            result = httpd_resp_send_chunk(request, reinterpret_cast<const char *>(frame->buf), frame->len);
        }
        esp_camera_fb_return(frame); // Release frame even if the PC disconnected.
        if (result != ESP_OK) {
            Serial.println("Video receiver disconnected");
            return result;
        }
        ++frames;
        if (millis() - lastReport >= 3000) {
            Serial.printf("TX: %u frames / 3 sec, free heap: %u\n", frames, ESP.getFreeHeap());
            frames = 0;
            lastReport = millis();
        }
        const unsigned long elapsed = millis() - frameStarted;
        const unsigned long wait = elapsed < STREAM_FRAME_INTERVAL_MS ? STREAM_FRAME_INTERVAL_MS - elapsed : 1;
        // Camera capture continues during pacing; GRAB_LATEST replaces old queued frames.
        vTaskDelay(pdMS_TO_TICKS(wait) > 0 ? pdMS_TO_TICKS(wait) : 1);
    }
}

bool initializeCamera() {
    camera_config_t config = {};
    config.ledc_channel = LEDC_CHANNEL_0;
    config.ledc_timer = LEDC_TIMER_0;
    // T-Camera V1.6.2 only: D0..D7 = Y2..Y9.
    config.pin_d0 = 34; config.pin_d1 = 13;
    config.pin_d2 = 14; config.pin_d3 = 35;
    config.pin_d4 = 39; config.pin_d5 = 38;
    config.pin_d6 = 37; config.pin_d7 = 36;
    config.pin_xclk = 4;
    config.pin_pclk = 25;
    config.pin_vsync = 5;
    config.pin_href = 27;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    config.pin_sccb_sda = 18;
    config.pin_sccb_scl = 23;
#else
    config.pin_sscb_sda = 18;
    config.pin_sscb_scl = 23;
#endif
    config.pin_pwdn = -1;
    config.pin_reset = -1;
    config.xclk_freq_hz = 20000000;
    config.pixel_format = PIXFORMAT_JPEG;
    bool hasPSRAM = psramFound();
    config.frame_size = FRAMESIZE_QVGA; // Always 320x240, including PSRAM boards.
    config.jpeg_quality = 22; // Larger JPEG quality index means smaller, lower-detail frames.
    config.fb_count = hasPSRAM ? 2 : 1;
    config.fb_location = hasPSRAM ? CAMERA_FB_IN_PSRAM : CAMERA_FB_IN_DRAM;
    config.grab_mode = hasPSRAM ? CAMERA_GRAB_LATEST : CAMERA_GRAB_WHEN_EMPTY;
    esp_err_t result = esp_camera_init(&config);
    if (result != ESP_OK) {
        Serial.printf("ERROR: camera initialization failed: 0x%x\n", result);
        Serial.println("Check V1.6.2 PCB, camera ribbon, power supply and PSRAM settings.");
        return false;
    }
    Serial.printf("Camera ready: PSRAM=%s, resolution=320x240, JPEG quality=22, target=8fps\n",
                  hasPSRAM ? "yes" : "no");
    return true;
}

bool startCameraServer() {
    if (cameraServer) return true;
    httpd_config_t serverConfig = HTTPD_DEFAULT_CONFIG();
    serverConfig.server_port = 80;
    serverConfig.stack_size = 8192;
    serverConfig.send_wait_timeout = 3; // Allow brief Wi-Fi stalls; latest-frame receivers discard backlog.
    serverConfig.lru_purge_enable = true;
    esp_err_t result = httpd_start(&cameraServer, &serverConfig);
    if (result == ESP_OK) {
        httpd_uri_t endpoint = {};
        endpoint.uri = "/stream";
        endpoint.method = HTTP_GET;
        endpoint.handler = streamVideo;
        result = httpd_register_uri_handler(cameraServer, &endpoint);
        if (result == ESP_OK) {
            endpoint.method = HTTP_OPTIONS;
            endpoint.handler = cameraOptions;
            result = httpd_register_uri_handler(cameraServer, &endpoint);
        }
    }
    if (result != ESP_OK) {
        if (cameraServer) httpd_stop(cameraServer);
        cameraServer = nullptr;
        Serial.printf("ERROR: streaming server startup failed: 0x%x\n", result);
        return false;
    }
    Serial.println("Ready. Open one Python or browser camera viewer at a time.");
    return true;
}


void maintainCameraWifi() {
    if (wifiState == WifiState::Connecting) {
        if (WiFi.status() == WL_CONNECTED) {
            wifiState = WifiState::Connected;
            if (cameraReady && !startCameraServer()) cameraReady = false;
            const String ip = WiFi.localIP().toString();
            if (cameraReady) showStatus("CAMERA READY", ip, "HTTP:80 /stream", "USB can update WiFi");
            else showStatus("CAMERA ERROR", ip, "Check camera hardware", "WiFi setup available");
            Serial.println("STREAM URL: http://" + ip + "/stream");
            reportWifiStatus();
        } else if (millis() - connectionStarted >= WIFI_TIMEOUT_MS) {
            WiFi.disconnect(false, false);
            wifiState = WifiState::Failed;
            showStatus("WiFi FAILED", "Set WiFi again", "Bridge USB settings", "Check SSID/password");
            reportWifiStatus();
        }
    } else if (wifiState == WifiState::Connected && WiFi.status() != WL_CONNECTED) {
        // Retry a dropped link once; failed attempts remain USB-configurable.
        beginWifiConnection();
    }
}

void setup() {
    Serial.setRxBufferSize(512);
    Serial.begin(115200);
    delay(300);
    serialLine.reserve(512);
    Wire.begin(21, 22);
    oledAvailable = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
    if (!oledAvailable) Serial.println("OLED unavailable; use bridge USB status");
    showStatus("LilyGO T-Camera", "Starting camera...");
    cameraReady = initializeCamera();
    if (loadWifiSettings()) beginWifiConnection();
    else {
        showStatus("WiFi NOT SET", "Set SSID/password", "Bridge USB settings");
        reportWifiStatus();
    }
}

void loop() {
    // Never wait in a Wi-Fi loop: a replacement configuration can arrive anytime.
    checkCameraSerial();
    maintainCameraWifi();
    delay(5);
}
