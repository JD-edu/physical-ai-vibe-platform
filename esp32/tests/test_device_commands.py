"""Compile the firmware's direct command parser with host-side GPIO mocks."""
import subprocess
import tempfile
from pathlib import Path

source = (Path(__file__).resolve().parents[1] / "esp32_firmware/esp32_firmware.ino").read_text()
parser = source[source.index("bool parseNumber("):source.index("// USB 시리얼 모니터에서")]
prefix = r'''
#include <cassert>
#include <cctype>
#include <cstdlib>
#include <string>
#include <vector>
struct String : std::string {
    using std::string::string;
    String(const std::string &s) : std::string(s) {}
    String substring(size_t start) const { return substr(start); }
    String substring(size_t start, size_t end) const { return substr(start, end-start); }
    int indexOf(char c) const { auto i = find(c); return i == npos ? -1 : int(i); }
    int lastIndexOf(char c) const { auto i = rfind(c); return i == npos ? -1 : int(i); }
    bool startsWith(const char *s) const { return rfind(s, 0) == 0; }
    long toInt() const { return std::strtol(c_str(), nullptr, 10); }
};
bool isDigit(char c) { return std::isdigit(static_cast<unsigned char>(c)); }
long map(long v, long a, long b, long c, long d) { return (v-a)*(d-c)/(b-a)+c; }
int leftMotor = 0, rightMotor = 0, servoIndex = -1, servoAngle = -1, stops = 0;
std::vector<std::string> statuses;
void setMotorSpeed(int motor, int speed) { (motor == 1 ? leftMotor : rightMotor) = speed; }
void stopAllMotors() { leftMotor = rightMotor = 0; ++stops; }
void setServoAngle(int index, int angle) { servoIndex = index; servoAngle = angle; }
void sendStatus(const String &status) { statuses.push_back(status); }
'''
tests = r'''
int main() {
    assert(processDeviceCommand("CMD:motor:forward:50")); assert(leftMotor == 50 && rightMotor == 50);
    assert(processDeviceCommand("CMD:motor:backward:35")); assert(leftMotor == -35 && rightMotor == -35);
    assert(processDeviceCommand("CMD:motor:left:40")); assert(leftMotor == -40 && rightMotor == 40);
    assert(processDeviceCommand("CMD:motor:right:40")); assert(leftMotor == 40 && rightMotor == -40);
    assert(processDeviceCommand("CMD:motor:stop:0")); assert(leftMotor == 0 && rightMotor == 0 && stops > 0);
    assert(processDeviceCommand("CMD:motor:30")); assert(leftMotor == 30 && rightMotor == 30);
    assert(processDeviceCommand("MOT:-255:255")); assert(leftMotor == -100 && rightMotor == 100);
    assert(processDeviceCommand("CMD:servo:90")); assert(servoIndex == 0 && servoAngle == 90);
    assert(processDeviceCommand("CMD:valve:180")); assert(servoIndex == 1 && servoAngle == 180);
    assert(processDeviceCommand("CMD:mouth:0")); assert(servoIndex == 2 && servoAngle == 0);
    const int previousLeft = leftMotor, previousRight = rightMotor, previousStops = stops;
    assert(!processDeviceCommand("CMD:motor:forward:81"));
    assert(!processDeviceCommand("CMD:motor:unknown:0"));
    assert(!processDeviceCommand("CMD:servo:181"));
    assert(!processDeviceCommand("MOT:300:0"));
    assert(leftMotor == previousLeft && rightMotor == previousRight && stops == previousStops);
}
'''
with tempfile.TemporaryDirectory() as directory:
    cpp, binary = Path(directory) / "commands.cpp", Path(directory) / "commands-test"
    cpp.write_text(prefix + parser + tests)
    subprocess.run(["g++", "-std=c++17", "-Wall", "-Wextra", "-Werror", str(cpp), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
print("PASS: ESP32 direct motor/servo commands and invalid-command rejection")
