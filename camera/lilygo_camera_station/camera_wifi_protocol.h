#pragma once
#include <cstddef>
#include <cstring>
#include <initializer_list>

// Small dependency-free wire codec shared with the firmware's host tests.
// SET <hex-UTF8-SSID> <hex-UTF8-password | ->, one newline-framed packet.
namespace camera_wifi {
struct Credentials {
    char ssid[33] = {};
    char password[64] = {};
};
inline bool validCredentials(const Credentials &value) {
    if (value.ssid[32] != '\0' || value.password[63] != '\0') return false;
    const size_t ssidLength = std::strlen(value.ssid), passwordLength = std::strlen(value.password);
    if (ssidLength < 1 || ssidLength > 32 || (passwordLength && (passwordLength < 8 || passwordLength > 63))) return false;
    for (const char *p : {value.ssid, value.password}) {
        for (; *p; ++p) if (*p == '\r' || *p == '\n') return false;
    }
    return true;
}
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
inline bool parseSettings(const char *line, Credentials &output) {
    const char *prefix = "CAMERA_WIFI_SET ";
    if (std::strncmp(line, prefix, std::strlen(prefix)) != 0) return false;
    const char *ssid = line + std::strlen(prefix), *separator = std::strchr(ssid, ' ');
    if (!separator) return false;
    const char *password = separator + 1;
    Credentials parsed;
    if (!decode(ssid, size_t(separator - ssid), parsed.ssid, sizeof(parsed.ssid))) return false;
    if (std::strcmp(password, "-") != 0 && !decode(password, std::strlen(password), parsed.password, sizeof(parsed.password))) return false;
    if (!validCredentials(parsed)) return false;
    output = parsed;
    return true;
}
// Preferences-compatible storage helpers keep boot priority and overwrite policy testable.
template <class Store>
bool loadCredentials(Store &store, const Credentials &fallback, Credentials &output, bool &saved) {
    Credentials stored;
    bool found = false;
    saved = false;
    if (store.begin("phycam", true)) {
        found = store.getBytesLength("credentials") == sizeof(stored) &&
                store.getBytes("credentials", &stored, sizeof(stored)) == sizeof(stored) &&
                validCredentials(stored);
        store.end();
    }
    if (found) { output = stored; saved = true; return true; }
    if (!validCredentials(fallback)) return false;
    output = fallback;
    return true;
}
template <class Store>
bool saveCredentials(Store &store, const Credentials &value) {
    if (!validCredentials(value) || !store.begin("phycam", false)) return false;
    const bool ok = store.putBytes("credentials", &value, sizeof(value)) == sizeof(value);
    store.end();
    return ok;
}
} // namespace camera_wifi
