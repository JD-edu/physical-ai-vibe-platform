#pragma once
#include <QJsonObject>
#include <QObject>
#include <QPair>
#include <QSocketNotifier>
#include <QTimer>

enum class WifiDevice { Camera, Controller };

// USB-only Wi-Fi provisioning for either ESP32 module. Video never passes here.
class CameraWifiSerial : public QObject {
    Q_OBJECT
public:
    explicit CameraWifiSerial(QObject *parent = nullptr, WifiDevice device = WifiDevice::Camera);
    ~CameraWifiSerial() override;
    static QList<QPair<QString, QString>> ports(); // device path, display label
    bool openPort(const QString &path, QString *error);
    void closePort();
    bool isOpen() const { return fd_ >= 0; }
    bool isCamera() const { return device_ == WifiDevice::Camera && verified_; }
    bool isDevice() const { return verified_; }
    bool sendSettings(const QString &ssid, const QString &password, QString *error, const QString &serverIp = {});
    void requestStatus();
signals:
    void portChanged(bool open);
    void cameraStatus(const QJsonObject &status);
    void deviceStatus(const QJsonObject &status);
    void errorOccurred(const QString &message);
private:
    void readAvailable();
    bool writeLine(const QByteArray &line);
    int fd_ = -1;
    bool verified_ = false;
    QByteArray buffer_;
    QSocketNotifier *reader_ = nullptr;
    QTimer handshake_;
    int attempts_ = 0;
    WifiDevice device_;
};
