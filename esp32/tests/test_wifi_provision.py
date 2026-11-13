"""Test the control ESP32 USB credential packet without an Arduino board."""
import subprocess
import tempfile
from pathlib import Path

header = Path(__file__).resolve().parents[1] / "esp32_firmware"
source = r'''
#include "esp32_wifi_protocol.h"
#include <cassert>
#include <cstring>
#include <initializer_list>
int main() {
    esp32_wifi::Settings value;
    assert(esp32_wifi::parseSettings("ESP32_WIFI_SET 546573742057694669 70617373776f7264313233 192.168.1.50", value));
    assert(std::strcmp(value.ssid, "Test WiFi") == 0);
    assert(std::strcmp(value.password, "password123") == 0);
    assert(std::strcmp(value.serverIp, "192.168.1.50") == 0);
    assert(esp32_wifi::parseSettings("ESP32_WIFI_SET 4f70656e - 10.0.0.1", value));
    assert(value.password[0] == '\0');
    for (const char *line : {
        "CAMERA_WIFI_SET 54657374 70617373776f7264313233 192.168.1.50",
        "ESP32_WIFI_SET 00 - 10.0.0.1",
        "ESP32_WIFI_SET 414 - 10.0.0.1",
        "ESP32_WIFI_SET 4142 31 10.0.0.1",
        "ESP32_WIFI_SET 4142 - 999.0.0.1",
        "ESP32_WIFI_SET 4142 - 10.0.0.1 extra",
        "ESP32_WIFI_SET 4142 - 10.0.0",
    }) assert(!esp32_wifi::parseSettings(line, value));
}
'''
with tempfile.TemporaryDirectory() as directory:
    cpp, binary = Path(directory) / "wifi.cpp", Path(directory) / "wifi-test"
    cpp.write_text(source)
    subprocess.run(["g++", "-std=c++17", "-Wall", "-Wextra", "-Werror", "-I", str(header), str(cpp), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
print("PASS: ESP32 Wi-Fi USB packet, open networks, invalid credentials and server IP")
