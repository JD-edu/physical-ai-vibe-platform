"""Exercise actual firmware connection functions with host Wi-Fi/clock stubs."""
from pathlib import Path
import re
import subprocess
import tempfile

source = Path('physical/esp32/esp32_firmware/esp32_firmware.ino').read_text()

def function(name):
    match = re.search(r'(?:bool|void) ' + name + r'\([^)]*\)\s*\{', source)
    assert match, name
    depth = 1
    end = match.end()
    while depth:
        if source[end] == '{':
            depth += 1
        elif source[end] == '}':
            depth -= 1
        end += 1
    return source[match.start():end]

stubs = r'''
#include <cassert>
#include <string>
#include <vector>
#include <iostream>
using String = std::string;
#define String(value) std::to_string(value)
constexpr int WL_CONNECTED = 3, WL_DISCONNECTED = 6, WIFI_STA = 1;
unsigned long nowMs = 0;
unsigned long millis() { return nowMs; }
void delay(unsigned long ms) { nowMs += ms; }
std::vector<std::string> statuses;
void sendStatus(const std::string &text) { statuses.push_back(text); }
void showOLEDMessage(const String &, const String & = "", const String & = "", const String & = "") {}
String shortenText(const String &text, int) { return text; }
String makeDots(int) { return "."; }
struct Address { String toString() const { return "192.168.0.2"; } };
struct FakeWiFi {
    int state = WL_DISCONNECTED, begins = 0, disconnects = 0, radioOffs = 0;
    bool connectOnBegin = true, autoReconnect = true;
    String ssid;
    int status() const { return state; }
    void mode(int) {}
    void setAutoReconnect(bool value) { autoReconnect = value; }
    void disconnect(bool off = false) { ++disconnects; radioOffs += off; state = WL_DISCONNECTED; }
    void begin(const char *name, const char *) { ++begins; ssid = name; state = connectOnBegin ? WL_CONNECTED : WL_DISCONNECTED; }
    String SSID() const { return ssid; }
    Address localIP() const { return {}; }
} WiFi;
struct FakeClient {
    bool alive = false, succeeds = true;
    int stops = 0, connects = 0;
    bool connected() const { return alive; }
    void stop() { ++stops; alive = false; }
    bool connect(const char *, int) { ++connects; alive = succeeds; return alive; }
    void println(const char *) {}
} commandClient;
bool connectionEnabled = false;
String wifiSSID = "test-network", wifiPassword = "test-password", serverIP = "192.168.0.1";
String activeWiFiSSID, activeWiFiPassword;
unsigned long lastWiFiReconnect = 0, lastServerReconnect = 0;
constexpr unsigned long WIFI_RECONNECT_INTERVAL = 5000, SERVER_RECONNECT_INTERVAL = 3000;
constexpr int COMMAND_PORT = 5001;
'''
checks = r'''
int main() {
    // No network activity before micro:bit enables CONNECT.
    assert(!connectWiFi()); maintainConnections(); assert(WiFi.begins == 0);
    connectionEnabled = true;
    assert(connectWiFi()); assert(connectCommandServer());
    const int initialBegins = WiFi.begins, initialDisconnects = WiFi.disconnects, initialStops = commandClient.stops;
    for (int i = 0; i < 5; ++i) { assert(connectWiFi()); assert(connectCommandServer()); }
    assert(WiFi.begins == initialBegins && WiFi.disconnects == initialDisconnects);
    assert(commandClient.stops == initialStops && commandClient.connects == 1);
    assert(WiFi.radioOffs == 0 && !WiFi.autoReconnect);
    // New credentials still deliberately reconnect.
    wifiPassword = "changed"; assert(connectWiFi()); assert(WiFi.begins == initialBegins + 1);
    // A TCP server outage must not reset working Wi-Fi.
    commandClient.alive = false; commandClient.succeeds = false;
    const int beforeServerRetry = WiFi.disconnects;
    nowMs += 3000; maintainConnections(); const int attempts = commandClient.connects;
    maintainConnections(); assert(commandClient.connects == attempts);
    assert(WiFi.disconnects == beforeServerRetry);
    // Failed Wi-Fi attempts receive a full 20-second window, then a 5-second cooldown.
    WiFi.state = WL_DISCONNECTED; WiFi.connectOnBegin = false;
    nowMs += 5000; const auto start = nowMs;
    maintainConnections(); assert(nowMs - start >= 20000);
    assert(lastWiFiReconnect == nowMs);
    const int failedBegins = WiFi.begins;
    maintainConnections(); assert(WiFi.begins == failedBegins);
    nowMs += 4999; maintainConnections(); assert(WiFi.begins == failedBegins);
    nowMs += 1; maintainConnections(); assert(WiFi.begins == failedBegins + 1);
    // Missing SSID also observes cooldown; it cannot flood the UART every loop.
    wifiSSID.clear(); nowMs += 5000; maintainConnections(); const auto statusCount = statuses.size();
    maintainConnections(); assert(statuses.size() == statusCount);
    std::cout << "ESP32 reconnect checks passed: duplicate CONNECT, credential changes, server-only retries, full attempt window and cooldown.\n";
}
'''
with tempfile.TemporaryDirectory(prefix='phyvibe-esp32-test-') as directory:
    file = Path(directory) / 'reconnect.cpp'
    binary = Path(directory) / 'reconnect'
    file.write_text(stubs + '\n'.join(function(name) for name in ['connectWiFi', 'connectCommandServer', 'maintainConnections']) + checks)
    subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', str(file), '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
