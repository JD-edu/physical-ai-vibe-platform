#include "camera_wifi_serial.h"
#include <QDir>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonParseError>
#include <QSet>
#include <cstring>
#ifdef Q_OS_UNIX
#include <cerrno>
#include <fcntl.h>
#include <sys/ioctl.h>
#include <termios.h>
#include <unistd.h>
#endif

CameraWifiSerial::CameraWifiSerial(QObject *parent) : QObject(parent) {
    handshake_.setInterval(1000);
    connect(&handshake_, &QTimer::timeout, this, [this] {
        if (++attempts_ > 8) {
            handshake_.stop();
            emit errorOccurred(QStringLiteral("카메라 응답이 없습니다. 포트와 최신 카메라 펌웨어를 확인하세요."));
            return;
        }
        requestStatus();
    });
}
CameraWifiSerial::~CameraWifiSerial() { closePort(); }

QList<QPair<QString, QString>> CameraWifiSerial::ports() {
    QList<QPair<QString, QString>> result;
    QSet<QString> seen;
    const QDir ids("/dev/serial/by-id");
    for (const auto &name : ids.entryList(QDir::Files | QDir::System | QDir::NoDotAndDotDot)) {
        const QString path = QFileInfo(ids.filePath(name)).canonicalFilePath();
        if (path.isEmpty() || seen.contains(path)) continue;
        seen.insert(path);
        result.append({path, QFileInfo(path).fileName() + " — " + name});
    }
    const QDir devices("/dev");
    for (const auto &name : devices.entryList({"ttyUSB*", "ttyACM*"}, QDir::System | QDir::Files)) {
        const QString path = devices.filePath(name);
        if (!seen.contains(path)) result.append({path, name});
    }
    return result;
}

bool CameraWifiSerial::openPort(const QString &path, QString *error) {
    closePort();
#ifdef Q_OS_UNIX
    fd_ = ::open(path.toLocal8Bit().constData(), O_RDWR | O_NOCTTY | O_NONBLOCK | O_CLOEXEC);
    if (fd_ < 0) { *error = QString::fromLocal8Bit(std::strerror(errno)); return false; }
    struct termios settings {};
    if (tcgetattr(fd_, &settings) != 0) {
        *error = QString::fromLocal8Bit(std::strerror(errno)); closePort(); return false;
    }
    cfmakeraw(&settings);
    cfsetispeed(&settings, B115200); cfsetospeed(&settings, B115200);
    settings.c_cflag |= CLOCAL | CREAD;
    settings.c_cflag &= ~(CSTOPB | PARENB | CRTSCTS | CSIZE | HUPCL);
    settings.c_cflag |= CS8;
    settings.c_cc[VMIN] = 1; settings.c_cc[VTIME] = 0;
    if (tcsetattr(fd_, TCSANOW, &settings) != 0) {
        *error = QString::fromLocal8Bit(std::strerror(errno)); closePort(); return false;
    }
    // Prevent another monitor from opening the port after this session starts.
    if (ioctl(fd_, TIOCEXCL) < 0 && errno != ENOTTY) {
        *error = QString::fromLocal8Bit(std::strerror(errno)); closePort(); return false;
    }
    reader_ = new QSocketNotifier(fd_, QSocketNotifier::Read, this);
    connect(reader_, &QSocketNotifier::activated, this, [this] { readAvailable(); });
    attempts_ = 0;
    handshake_.start();
    emit portChanged(true);
    requestStatus();
    return isOpen();
#else
    Q_UNUSED(path)
    *error = "USB camera provisioning currently supports the Linux bridge build";
    return false;
#endif
}

void CameraWifiSerial::closePort() {
    handshake_.stop();
    if (reader_) { reader_->setEnabled(false); reader_->deleteLater(); reader_ = nullptr; }
    const bool wasOpen = isOpen();
#ifdef Q_OS_UNIX
    if (fd_ >= 0) { ioctl(fd_, TIOCNXCL); ::close(fd_); }
#endif
    fd_ = -1; verified_ = false; buffer_.clear();
    if (wasOpen) emit portChanged(false);
}

bool CameraWifiSerial::writeLine(const QByteArray &line) {
#ifdef Q_OS_UNIX
    if (fd_ < 0) return false;
    // A settings packet is <= 208 bytes. Never log it: hex encoding is not encryption.
    const auto sent = ::write(fd_, line.constData(), size_t(line.size()));
    if (sent == line.size()) return true;
    closePort();
    emit errorOccurred(QStringLiteral("USB 송신 실패: 연결을 다시 열어 주세요."));
#else
    Q_UNUSED(line)
#endif
    return false;
}

void CameraWifiSerial::requestStatus() { writeLine("CAMERA_WIFI_STATUS\n"); }

bool CameraWifiSerial::sendSettings(const QString &ssid, const QString &password, QString *error) {
    if (!isOpen() || !verified_) { *error = QStringLiteral("먼저 최신 펌웨어의 카메라에 USB 연결하세요."); return false; }
    const auto name = ssid.toUtf8(), secret = password.toUtf8();
    if (name.isEmpty() || name.size() > 32 || (secret.size() != 0 && (secret.size() < 8 || secret.size() > 63)) ||
        ssid.contains('\n') || ssid.contains('\r') || ssid.contains(QChar(0)) ||
        password.contains('\n') || password.contains('\r') || password.contains(QChar(0))) {
        *error = QStringLiteral("SSID는 UTF-8 1~32바이트, 비밀번호는 8~63바이트 또는 개방형 네트워크의 빈 값이어야 합니다.");
        return false;
    }
    const QByteArray packet = "CAMERA_WIFI_SET " + name.toHex() + " " + (secret.isEmpty() ? QByteArray("-") : secret.toHex()) + '\n';
    return writeLine(packet);
}

void CameraWifiSerial::readAvailable() {
#ifdef Q_OS_UNIX
    char data[1024];
    while (fd_ >= 0) {
        const auto count = ::read(fd_, data, sizeof(data));
        if (count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) break;
        if (count < 0 && errno == EINTR) continue;
        if (count <= 0) { closePort(); emit errorOccurred(QStringLiteral("USB 카메라 연결이 끊겼습니다.")); return; }
        buffer_.append(data, int(count));
        int end;
        while ((end = buffer_.indexOf('\n')) >= 0) {
            const QByteArray line = buffer_.left(end).trimmed(); buffer_.remove(0, end + 1);
            // Ignore boot/stream logs. Only the camera's typed status is trusted.
            if (!line.startsWith("CAMERA_WIFI ")) continue;
            QJsonParseError error;
            const auto document = QJsonDocument::fromJson(line.mid(12), &error);
            if (error.error != QJsonParseError::NoError || !document.isObject()) continue;
            const auto status = document.object();
            if (status.value("device") != "phyvibe-camera" || status.value("protocol").toInt() != 1 || !status.value("state").isString()) continue;
            verified_ = true; handshake_.stop();
            emit cameraStatus(status);
        }
        if (buffer_.size() > 4096) buffer_.clear();
    }
#endif
}
