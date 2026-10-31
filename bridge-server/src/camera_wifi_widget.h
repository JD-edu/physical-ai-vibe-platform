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
    explicit CameraWifiWidget(QWidget *parent = nullptr);
private:
    void refreshPorts();
    CameraWifiSerial serial_;
    QComboBox *port_;
    QLineEdit *ssid_, *password_, *url_;
    QLabel *status_;
    QPushButton *connect_, *send_;
};
