#include "bridge_window.h"
#include "camera_wifi_widget.h"
#include <QGroupBox>
#include <QScrollArea>
#include <QTabWidget>
#include <QDateTime>
#include <QFormLayout>
#include <QHBoxLayout>
#include <QJsonObject>
#include <QLabel>
#include <QLineEdit>
#include <QNetworkInterface>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QSpinBox>
#include <QVBoxLayout>

#include <QPainter>
#include <QTimer>
#include <QTreeWidget>
#include <QHeaderView>

class ConnectionDiagram : public QWidget {
public:
    explicit ConnectionDiagram(QWidget *parent = nullptr) : QWidget(parent) {
        setMinimumSize(720, 230);
        setAccessibleName(QStringLiteral("웹앱, 연결 서버, PhyVibe ESP32 연결 상태"));
    }
    void setState(bool running, bool web, int devices, int healthy) {
        running_ = running; web_ = web; devices_ = devices; healthy_ = healthy;
        if (devices > 0) seenDevice_ = true;
        update();
        setAccessibleDescription(QStringLiteral("서버 %1, 웹앱 %2, ESP32 %3대, 응답 확인 %4대")
            .arg(running ? "실행 중" : "중지", web ? "최근 통신 있음" : "최근 통신 없음").arg(devices).arg(healthy));
    }
protected:
    void paintEvent(QPaintEvent *) override {
        QPainter p(this); p.setRenderHint(QPainter::Antialiasing);
        p.scale(width() / 800.0, height() / 230.0);
        const QColor green("#12846b"), muted("#718096"), amber("#a86b12");
        auto link = [&](int x, bool active, const QString &label) {
            const QColor color = active ? green : muted;
            p.setPen(QPen(color, 2, active ? Qt::SolidLine : Qt::DashLine));
            p.drawLine(x, 112, x + 44, 112);
            p.drawLine(x + 44, 112, x + 37, 107); p.drawLine(x + 44, 112, x + 37, 117);
            p.drawLine(x, 112, x + 7, 107); p.drawLine(x, 112, x + 7, 117);
            p.setPen(color); p.drawText(QRect(x - 15, 73, 94, 28), Qt::AlignCenter, label);
        };
        link(241, running_ && web_, "HTTP"); link(511, running_ && devices_ > 0, "Wi-Fi");
        auto card = [&](int x, int kind, const QString &title, const QString &subtitle,
                        const QString &state, const QColor &color) {
            p.setPen(QPen(QColor("#dce4ed"), 1)); p.setBrush(QColor("#f6f9fc"));
            p.drawRoundedRect(QRectF(x, 12, 220, 202), 16, 16);
            p.setPen(QPen(color, 2)); p.setBrush(Qt::NoBrush);
            if (kind == 0) {
                p.drawRoundedRect(QRectF(x + 84, 33, 52, 36), 4, 4);
                p.drawLine(x + 84, 43, x + 136, 43); p.drawLine(x + 96, 76, x + 124, 76);
                p.drawLine(x + 110, 69, x + 110, 76);
            } else if (kind == 1) {
                for (int y : {33, 50, 67}) {
                    p.drawRoundedRect(QRectF(x + 86, y, 48, 12), 3, 3);
                    p.drawEllipse(QPointF(x + 126, y + 6), 1.5, 1.5);
                }
            } else {
                p.drawRoundedRect(QRectF(x + 91, 38, 38, 38), 4, 4);
                p.drawText(QRect(x + 91, 38, 38, 38), Qt::AlignCenter, "ESP");
                for (int d : {0, 10, 20}) {
                    p.drawLine(x + 99 + d, 32, x + 99 + d, 38);
                    p.drawLine(x + 99 + d, 76, x + 99 + d, 82);
                }
            }
            auto font = p.font(); font.setPointSize(13); font.setBold(true); p.setFont(font);
            p.setPen(QColor("#1c3048")); p.drawText(QRect(x, 94, 220, 27), Qt::AlignCenter, title);
            font.setPointSize(10); font.setBold(false); p.setFont(font);
            p.setPen(muted); p.drawText(QRect(x, 123, 220, 24), Qt::AlignCenter, subtitle);
            p.setPen(color); p.drawText(QRect(x + 6, 161, 208, 30), Qt::AlignCenter, state);
        };
        card(20, 0, "웹앱", "화면에서 명령 · 센서값 확인", web_ && running_ ? "● 최근 통신 있음" : "○ 최근 통신 없음", web_ && running_ ? green : amber);
        card(290, 1, "PhyVibe 연결 서버", "웹앱과 디바이스 사이의 다리", running_ ? "● 실행 중" : "○ 중지됨", running_ ? green : muted);
        const bool healthy = running_ && devices_ > 0 && healthy_ == devices_;
        const QString deviceStatus = !running_ ? "○ 서버 중지됨" : devices_ == 0
            ? (seenDevice_ ? "○ 연결 끊김" : "○ 연결 대기")
            : healthy ? QString("● %1대 응답 정상").arg(healthy_)
                      : QString("◐ TCP %1대 · 응답 확인 중").arg(devices_);
        card(560, 2, "PhyVibe 디바이스", "ESP32 · 연결 상태 감시", deviceStatus, healthy ? green : amber);
    }
private:
    bool running_ = false, web_ = false;
    int devices_ = 0, healthy_ = 0;
    bool seenDevice_ = false;
};

BridgeWindow::BridgeWindow(BridgeServer *server, const QHostAddress &address, int httpPort, int tcpPort)
    : server_(server), address_(address) {
    setWindowTitle("PHYVIBE C++ Bridge");
    resize(940, 820);
    auto *outer = new QVBoxLayout(this);
    auto *tabs = new QTabWidget;
    tabs->setObjectName("bridgeTabs");
    outer->addWidget(tabs);

    // Each tab owns its page, so switching tabs keeps server/USB sessions alive.
    auto *scroll = new QScrollArea;
    scroll->setWidgetResizable(true);
    auto *content = new QWidget;
    scroll->setWidget(content);
    tabs->addTab(scroll, "브릿지 서버");
    auto *layout = new QVBoxLayout(content);

    auto *cameraScroll = new QScrollArea;
    cameraScroll->setWidgetResizable(true);
    auto *cameraPage = new QWidget;
    cameraScroll->setWidget(cameraPage);
    auto *cameraPageLayout = new QVBoxLayout(cameraPage);
    auto *cameraGroup = new QGroupBox("ESP32 카메라 · USB Wi-Fi 설정");
    auto *cameraLayout = new QVBoxLayout(cameraGroup);
    cameraLayout->addWidget(new CameraWifiWidget(cameraGroup));
    cameraPageLayout->addWidget(cameraGroup);
    cameraPageLayout->addStretch();
    tabs->addTab(cameraScroll, "카메라 Wi-Fi 설정");
    auto *controlScroll = new QScrollArea;
    controlScroll->setWidgetResizable(true);
    auto *controlPage = new QWidget;
    controlScroll->setWidget(controlPage);
    auto *controlLayout = new QVBoxLayout(controlPage);
    auto *controlGroup = new QGroupBox("제어용 ESP32 · USB Wi-Fi 설정");
    auto *controlGroupLayout = new QVBoxLayout(controlGroup);
    controlGroupLayout->addWidget(new CameraWifiWidget(controlGroup, WifiDevice::Controller));
    controlLayout->addWidget(controlGroup);
    controlLayout->addStretch();
    tabs->addTab(controlScroll, "ESP32 Wi-Fi 설정");
    diagram_ = new ConnectionDiagram(this);
    diagram_->setObjectName("connectionDiagram");
    layout->addWidget(diagram_);
    deviceLinks_ = new QTreeWidget;
    deviceLinks_->setObjectName("deviceLinkStatus");
    deviceLinks_->setColumnCount(4);
    deviceLinks_->setHeaderLabels({"ESP32 주소", "상태", "최근 응답", "감지 방식"});
    deviceLinks_->setRootIsDecorated(false);
    deviceLinks_->setMinimumHeight(90);
    deviceLinks_->setMaximumHeight(140);
    deviceLinks_->header()->setSectionResizeMode(QHeaderView::ResizeToContents);
    deviceLinks_->header()->setStretchLastSection(true);
    layout->addWidget(deviceLinks_);
    auto *linkHint = new QLabel("연결·응답·끊김 이벤트는 아래 NET 로그에 표시됩니다. 웹앱 표시는 최근 5초의 HTTP 통신 기준입니다.");
    linkHint->setWordWrap(true); layout->addWidget(linkHint);
    auto *refresh = new QTimer(this);
    connect(refresh, &QTimer::timeout, this, [this] { updateState(); });
    refresh->start(1000);

    QStringList lan;
    if (address_ != QHostAddress::Any && address_ != QHostAddress::AnyIPv4
        && address_ != QHostAddress::AnyIPv6) {
        lan << address_.toString();
    } else {
        for (const auto &ip : QNetworkInterface::allAddresses())
            if (ip.protocol() == QAbstractSocket::IPv4Protocol && !ip.isLoopback())
                lan << ip.toString();
        lan.removeDuplicates();
    }
    auto *serverIp = new QLabel(lan.isEmpty() ? QString("IP 없음") : lan.join("\n"));
    serverIp->setAlignment(Qt::AlignLeft | Qt::AlignVCenter);
    serverIp->setTextInteractionFlags(Qt::TextSelectableByMouse);
    serverIp->setAccessibleName(QStringLiteral("서버 IP 주소"));
    serverIp->setContentsMargins(0, 6, 0, 6);
    layout->addWidget(serverIp);
    auto *ports = new QFormLayout;
    httpPort_ = new QSpinBox; httpPort_->setRange(0, 65535); httpPort_->setValue(httpPort);
    tcpPort_ = new QSpinBox; tcpPort_->setRange(0, 65535); tcpPort_->setValue(tcpPort);
    ports->addRow("HTTP port (Studio / webapps)", httpPort_);
    ports->addRow("TCP port (ESP32 commands)", tcpPort_);
    layout->addLayout(ports);
    auto *buttons = new QHBoxLayout;
    start_ = new QPushButton("서버 시작"); stop_ = new QPushButton("서버 중지");
    buttons->addWidget(start_); buttons->addWidget(stop_); layout->addLayout(buttons);
    monitor_ = new QPlainTextEdit; monitor_->setReadOnly(true); monitor_->setMaximumBlockCount(200); monitor_->setMinimumHeight(130);
    layout->addWidget(monitor_);
    auto *commands = new QHBoxLayout;
    command_ = new QLineEdit; command_->setPlaceholderText("Send literal text, e.g. a, or CMD:servo:90");
    send_ = new QPushButton("Send to ESP32"); commands->addWidget(command_); commands->addWidget(send_); layout->addLayout(commands);
    auto *clear = new QPushButton("Clear monitor"); layout->addWidget(clear);
    connect(clear, &QPushButton::clicked, monitor_, &QPlainTextEdit::clear);
    connect(start_, &QPushButton::clicked, this, [this] { startServer(); });
    connect(stop_, &QPushButton::clicked, server_, &BridgeServer::stop);
    auto send = [this] {
        int code;
        const auto result = server_->sendCommand(command_->text(), &code);
        if (code >= 400) monitor_->appendPlainText("ERR " + result.value("error").toString());
    };
    connect(send_, &QPushButton::clicked, this, send);
    connect(command_, &QLineEdit::returnPressed, this, send);
    connect(server_, &BridgeServer::packet, this, [this](const QString &direction, const QString &message) {
        monitor_->appendPlainText(QDateTime::currentDateTime().toString("HH:mm:ss") + " " + direction + " " + message);
    });
    connect(server_, &BridgeServer::runningChanged, this, [this] { updateState(); });
    connect(server_, &BridgeServer::clientsChanged, this, [this] { updateState(); });
    connect(server_, &BridgeServer::stateChanged, this, [this] { updateState(); });
    updateState();
}

bool BridgeWindow::startServer() {
    QString error;
    if (!server_->start(address_, httpPort_->value(), tcpPort_->value(), &error)) {
        monitor_->appendPlainText("ERR " + error);
        return false;
    }
    return true;
}

void BridgeWindow::updateState() {
    const bool running = server_->isRunning();
    start_->setEnabled(!running); stop_->setEnabled(running); send_->setEnabled(running);
    httpPort_->setEnabled(!running); tcpPort_->setEnabled(!running);
    const auto state = server_->status();
    diagram_->setState(running, state.value("web_active").toBool(),
                       state.value("connected_clients").toInt(), state.value("healthy_clients").toInt());
    deviceLinks_->clear();
    for (const auto &value : state.value("devices").toArray()) {
        const auto device = value.toObject();
        const auto mode = device.value("link_mode").toString();
        const auto health = device.value("state").toString();
        const int age = device.value("last_pong_age_ms").toInt(-1);
        const QString address = device.value("peer").toString() + ":" + QString::number(device.value("port").toInt());
        const QString label = health == "online" ? "응답 정상" : health == "checking" ? "응답 확인 중" : "TCP 연결 · 생존 미확인";
        auto *row = new QTreeWidgetItem(deviceLinks_, {address, label,
            age >= 0 ? QString("%1초 전").arg(age / 1000.0, 0, 'f', 1) : "아직 없음",
            mode == "heartbeat" ? "ESP32 하트비트" : "TCP keepalive · 펌웨어 업데이트 권장"});
        row->setToolTip(0, device.value("device_id").toString());
    }
}
