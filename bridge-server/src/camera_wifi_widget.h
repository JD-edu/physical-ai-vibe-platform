#pragma once
#include <QWidget>
#include "camera_wifi_serial.h"
class QComboBox;
class QLineEdit;
class QLabel;
class QPushButton;
class CameraWifiWidget : public QWidget {
    Q_OBJECT
public:
    explicit CameraWifiWidget(QWidget *parent = nullptr, WifiDevice device = WifiDevice::Camera);
private:
    void refreshPorts();
    CameraWifiSerial serial_;
    QComboBox *port_;
    QLineEdit *ssid_, *password_, *url_, *serverIp_;
    QLabel *status_;
    QPushButton *connect_, *send_;
    WifiDevice device_;
};
