#include "camera_wifi_widget.h"
#include <QComboBox>
#include <QFormLayout>
#include <QHBoxLayout>
#include <QLabel>
#include <QLineEdit>
#include <QPushButton>
#include <QTimer>
#include <QVBoxLayout>

CameraWifiWidget::CameraWifiWidget(QWidget *parent) : QWidget(parent) {
    auto *layout = new QVBoxLayout(this);
    layout->setContentsMargins(0, 0, 0, 0);
    auto *row = new QHBoxLayout;
    port_ = new QComboBox; port_->setObjectName("cameraSerialPort"); port_->setEditable(true); port_->setMinimumWidth(240);
    port_->setSizeAdjustPolicy(QComboBox::AdjustToMinimumContentsLengthWithIcon);
    auto *refresh = new QPushButton("포트 새로고침");
    connect_ = new QPushButton("USB 연결"); connect_->setObjectName("cameraConnect");
    row->addWidget(port_, 1); row->addWidget(refresh); row->addWidget(connect_); layout->addLayout(row);
    auto *form = new QFormLayout;
    ssid_ = new QLineEdit; ssid_->setObjectName("cameraSsid"); ssid_->setPlaceholderText("2.4 GHz 공유기 SSID");
    password_ = new QLineEdit; password_->setObjectName("cameraPassword"); password_->setEchoMode(QLineEdit::Password);
    password_->setPlaceholderText("공유기 비밀번호 (개방형 네트워크는 빈 값)");
    url_ = new QLineEdit; url_->setObjectName("cameraStreamUrl"); url_->setReadOnly(true); url_->setPlaceholderText("연결 성공 후 카메라 주소가 표시됩니다");
    form->addRow("SSID", ssid_); form->addRow("비밀번호", password_); form->addRow("카메라 스트림", url_); layout->addLayout(form);
    send_ = new QPushButton("설정 저장 및 카메라 연결"); send_->setObjectName("cameraSaveWifi"); send_->setEnabled(false);
    layout->addWidget(send_);
    status_ = new QLabel("카메라 USB 포트를 선택해 연결하세요. 115200 baud"); status_->setObjectName("cameraWifiStatus"); status_->setWordWrap(true); layout->addWidget(status_);
    auto *note = new QLabel("USB는 Wi-Fi 설정용입니다. 설정을 바꾸면 저장된 값을 덮어씁니다. 영상은 에디터·웹앱에서 직접 받습니다.");
    note->setWordWrap(true); layout->addWidget(note);
    connect(refresh, &QPushButton::clicked, this, &CameraWifiWidget::refreshPorts);
    connect(connect_, &QPushButton::clicked, this, [this] {
        if (serial_.isOpen()) { serial_.closePort(); return; }
        QString error;
        const QString path = port_->currentText() == port_->itemText(port_->currentIndex()) && port_->currentData().isValid()
            ? port_->currentData().toString() : port_->currentText().trimmed();
        if (!serial_.openPort(path, &error)) status_->setText("USB 연결 실패: " + error);
    });
    connect(&serial_, &CameraWifiSerial::portChanged, this, [this, refresh](bool open) {
        connect_->setText(open ? "USB 연결 해제" : "USB 연결"); port_->setEnabled(!open); refresh->setEnabled(!open);
        send_->setEnabled(false); url_->clear();
        status_->setText(open ? "카메라 펌웨어 응답 확인 중…" : "USB 연결이 해제되었습니다.");
    });
    connect(&serial_, &CameraWifiSerial::errorOccurred, this, [this](const QString &message) { status_->setText(message); });
    connect(&serial_, &CameraWifiSerial::cameraStatus, this, [this](const QJsonObject &status) {
        const QString state = status.value("state").toString();
        // A replacement network can be submitted even during an old connection attempt.
        send_->setEnabled(serial_.isCamera());
        if (ssid_->text().isEmpty() && !status.value("ssid").toString().isEmpty()) ssid_->setText(status.value("ssid").toString());
        if (state == "connected") {
            status_->setText("카메라 Wi-Fi 연결 완료 · 현재 SSID: " + status.value("ssid").toString());
            url_->setText(status.value("url").toString());
            if (ssid_->text().isEmpty()) ssid_->setText(status.value("ssid").toString());
        } else {
            url_->clear();
            if (state == "connecting") status_->setText("설정된 공유기에 연결 중…");
            else if (state == "needs_setup") status_->setText("저장된 설정이 없습니다. SSID와 비밀번호를 전송하세요.");
            else if (state == "wifi_failed") status_->setText("Wi-Fi 연결 실패. SSID와 비밀번호를 다시 설정하세요.");
            else if (state == "storage_error") status_->setText("카메라 설정 저장 실패. 다시 전송하세요.");
            else if (state == "invalid_settings") status_->setText("카메라가 설정을 거부했습니다. SSID와 비밀번호 길이를 확인하세요.");
            else if (state == "camera_error") status_->setText("Wi-Fi는 연결됐지만 카메라 초기화에 실패했습니다. 카메라 핀과 리본을 확인하세요.");
            else status_->setText("카메라 상태: " + state);
        }
    });
    connect(send_, &QPushButton::clicked, this, [this] {
        QString error;
        if (!serial_.sendSettings(ssid_->text(), password_->text(), &error)) {
            status_->setText(error.isEmpty() ? "USB 설정 전송에 실패했습니다." : error); return;
        }
        // Passwords are neither persisted on the PC nor written to the bridge log.
        password_->clear(); url_->clear(); send_->setEnabled(false);
        status_->setText("설정을 전송했습니다. 카메라의 저장·연결 결과를 기다리는 중…");
        QTimer::singleShot(25000, this, [this] { if (serial_.isCamera()) { send_->setEnabled(true); serial_.requestStatus(); } });
    });
    refreshPorts();
}

void CameraWifiWidget::refreshPorts() {
    const auto current = port_->currentData().toString();
    port_->clear();
    for (const auto &entry : CameraWifiSerial::ports()) port_->addItem(entry.second, entry.first);
    const int index = port_->findData(current);
    if (index >= 0) port_->setCurrentIndex(index);
    if (port_->count() == 0) port_->setEditText("/dev/ttyUSB0");
}
