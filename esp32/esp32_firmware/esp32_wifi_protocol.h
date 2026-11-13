#pragma once
#include <cstddef>
#include <cstring>

// USB line: ESP32_WIFI_SET <hex UTF-8 SSID> <hex UTF-8 password | -> <IPv4>
namespace esp32_wifi {
struct Settings {
    char ssid[33] = {};
    char password[64] = {};
    char serverIp[16] = {};
};
inline int digit(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}
inline bool decode(const char *input, size_t length, char *output, size_t capacity) {
    if (length % 2 || length / 2 >= capacity) return false;
    for (size_t i = 0; i < length; i += 2) {
        const int high = digit(input[i]), low = digit(input[i + 1]);
        if (high < 0 || low < 0 || (high == 0 && low == 0)) return false;
        output[i / 2] = char((high << 4) | low);
    }
    output[length / 2] = '\0';
    return true;
}
inline bool validIp(const char *text) {
    int parts = 0;
    const char *p = text;
    while (*p) {
        if (++parts > 4) return false;
        int value = 0, digits = 0;
        while (*p >= '0' && *p <= '9') {
            value = value * 10 + (*p++ - '0');
            if (++digits > 3 || value > 255) return false;
        }
        if (!digits) return false;
        if (parts == 4) return *p == '\0';
        if (*p++ != '.') return false;
    }
    return false;
}
inline bool validSettings(const Settings &value) {
    if (value.ssid[32] != '\0' || value.password[63] != '\0' || value.serverIp[15] != '\0') return false;
    const size_t ssidLength = std::strlen(value.ssid), passwordLength = std::strlen(value.password);
    return ssidLength >= 1 && ssidLength <= 32 &&
           (passwordLength == 0 || (passwordLength >= 8 && passwordLength <= 63)) &&
           validIp(value.serverIp);
}
inline bool parseSettings(const char *line, Settings &output) {
    constexpr char prefix[] = "ESP32_WIFI_SET ";
    if (std::strncmp(line, prefix, sizeof(prefix) - 1) != 0) return false;
    const char *ssid = line + sizeof(prefix) - 1;
    const char *separator = std::strchr(ssid, ' ');
    if (!separator) return false;
    const char *password = separator + 1;
    const char *ip = std::strchr(password, ' ');
    if (!ip) return false;
    Settings parsed;
    if (!decode(ssid, size_t(separator - ssid), parsed.ssid, sizeof(parsed.ssid))) return false;
    if (!(ip - password == 1 && *password == '-') &&
        !decode(password, size_t(ip - password), parsed.password, sizeof(parsed.password))) return false;
    ++ip;
    if (std::strlen(ip) >= sizeof(parsed.serverIp) || !validIp(ip)) return false;
    std::strcpy(parsed.serverIp, ip);
    if (!validSettings(parsed)) return false;
    output = parsed;
    return true;
}
} // namespace esp32_wifi
