#pragma once
#include <QJsonObject>
#include <QObject>
#include <QPair>
#include <QSocketNotifier>
#include <QTimer>

// Camera provisioning is USB-only. Camera video never passes through this object.
class CameraWifiSerial : public QObject {
    Q_OBJECT
public:
    explicit CameraWifiSerial(QObject *parent = nullptr);
    ~CameraWifiSerial() override;
    static QList<QPair<QString, QString>> ports(); // device path, display label
    bool openPort(const QString &path, QString *error);
    void closePort();
    bool isOpen() const { return fd_ >= 0; }
    bool isCamera() const { return verified_; }
    bool sendSettings(const QString &ssid, const QString &password, QString *error);
    void requestStatus();
signals:
    void portChanged(bool open);
    void cameraStatus(const QJsonObject &status);
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
};
