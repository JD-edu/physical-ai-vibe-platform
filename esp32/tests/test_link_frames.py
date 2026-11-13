"""Compile the actual TCP frame handlers against a host-side device mock."""
import subprocess
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = (root / 'esp32_firmware/esp32_firmware.ino').read_text()
handlers = source[source.index('void handleServerLine('):source.index('\nvoid maintainConnections()')]
prefix = r'''
#include <string>
#include <vector>
#include <cassert>
struct String : std::string {
    using std::string::string;
    using std::string::operator=;
    String(const std::string &s) : std::string(s) {}
    bool startsWith(const char *p) const { return rfind(p, 0) == 0; }
    bool endsWith(const char *p) const { const std::string t=p; return size() >= t.size() && compare(size()-t.size(), t.size(), t)==0; }
    String substring(size_t start) const { return substr(start); }
    void remove(size_t start) { erase(start); }
};
struct Logger { std::vector<std::string> lines; void println(const std::string &s) { lines.push_back(s); } } Serial;
struct Client : Logger {
    std::string input;
    size_t position = 0;
    bool connected() { return true; }
    int available() { return int(input.size()-position); }
    int read() { return input[position++]; }
} commandClient;
bool connectionEnabled = true, discardCommandLine = false;
String commandReceiveBuffer, oledRxLine;
int displayUpdates = 0;
String shortenText(const String &text, int limit) { return text.substr(0, size_t(limit)); }
void showBridgeTraffic() { ++displayUpdates; }
std::vector<std::string> deviceCommands;
bool processDeviceCommand(const String &command) { deviceCommands.push_back(command); return true; }
'''
tests = r'''
void inject(const std::string &bytes) { commandClient.input += bytes; checkServerCommand(); }
int main() {
    inject("PHYVIBE_LINK_PI"); assert(commandClient.lines.empty()); assert(deviceCommands.empty());
    inject("NG:abc123"); assert(commandClient.lines.empty());
    inject("\r\n");
    assert(commandClient.lines == std::vector<std::string>{"PHYVIBE_LINK_PONG:abc123"});
    assert(deviceCommands.empty()); assert(displayUpdates == 0);
    inject("CMD:motor:forward:"); assert(deviceCommands.empty());
    inject("50\n");
    assert(deviceCommands == std::vector<std::string>{"CMD:motor:forward:50"}); assert(displayUpdates == 1);
    inject("\n\r\nPHYVIBE_LINK_PING:\nPHYVIBE_LINK_UNKNOWN:x\n");
    assert(deviceCommands.size() == 1); assert(displayUpdates == 1); assert(commandClient.lines.size() == 1);
    inject(" A \r\n"); assert(deviceCommands.back() == " A ");
    const auto count = deviceCommands.size();
    inject(std::string(1100, 'x')); inject("suffix\nCMD:motor:stop:0\n");
    assert(deviceCommands.size() == count + 1); assert(deviceCommands.back() == "CMD:motor:stop:0");
}
'''
with tempfile.TemporaryDirectory() as directory:
    cpp, binary = Path(directory) / 'link.cpp', Path(directory) / 'link-test'
    cpp.write_text(prefix + handlers + tests)
    subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', str(cpp), '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
print('PASS: fragmented link ping -> ESP32 pong; direct device dispatch, framing and overflow recovery.')
