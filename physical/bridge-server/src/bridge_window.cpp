#include "bridge_window.h"
#include <QDateTime>
#include <QCheckBox>
#include <QUuid>
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

BridgeWindow::BridgeWindow(BridgeServer *server, const QHostAddress &address, int httpPort, int tcpPort)
    : server_(server), address_(address) {
    setWindowTitle("PHYVIBE C++ Bridge");
    resize(850, 620);
    auto *layout = new QVBoxLayout(this);
    auto *title = new QLabel("<h2>PHYVIBE Network Bridge</h2>Independent server for Studio and customer webapps");
    layout->addWidget(title);
    QStringList lan;
    for (const auto &ip : QNetworkInterface::allAddresses())
        if (ip.protocol() == QAbstractSocket::IPv4Protocol && !ip.isLoopback()) lan << ip.toString();
    layout->addWidget(new QLabel("PC LAN address: " + (lan.isEmpty() ? QString("unavailable") : lan.join(", "))));
    auto *ports = new QFormLayout;
    httpPort_ = new QSpinBox; httpPort_->setRange(0, 65535); httpPort_->setValue(httpPort);
    tcpPort_ = new QSpinBox; tcpPort_->setRange(0, 65535); tcpPort_->setValue(tcpPort);
    ports->addRow("HTTP port (Studio / webapps)", httpPort_);
    ports->addRow("TCP port (ESP32 commands)", tcpPort_);
    layout->addLayout(ports);
    auto *buttons = new QHBoxLayout;
    start_ = new QPushButton("Start server"); stop_ = new QPushButton("Stop server");
    buttons->addWidget(start_); buttons->addWidget(stop_); layout->addLayout(buttons);
    status_ = new QLabel; clients_ = new QLabel; latestRx_ = new QLabel; latestTx_ = new QLabel;
    for (auto *label : {status_, clients_, latestRx_, latestTx_}) { label->setWordWrap(true); layout->addWidget(label); }
    layout->addWidget(new QLabel("Bidirectional network data (RX / TX)"));
    monitor_ = new QPlainTextEdit; monitor_->setReadOnly(true); monitor_->setMaximumBlockCount(200);
    layout->addWidget(monitor_);
    auto *commands = new QHBoxLayout;
    command_ = new QLineEdit; command_->setPlaceholderText("Send literal text, e.g. a, or CMD:servo:90");
    send_ = new QPushButton("Send to ESP32"); commands->addWidget(command_); commands->addWidget(send_); layout->addLayout(commands);
    acknowledged_ = new QCheckBox("Protocol v1: require micro:bit execution ACK (updated MakeCode program required)");
    layout->addWidget(acknowledged_);
    auto *clear = new QPushButton("Clear monitor"); layout->addWidget(clear);
    connect(clear, &QPushButton::clicked, monitor_, &QPlainTextEdit::clear);
    connect(start_, &QPushButton::clicked, this, [this] { startServer(); });
    connect(stop_, &QPushButton::clicked, server_, &BridgeServer::stop);
    auto send = [this] {
        int code;
        const auto result = acknowledged_->isChecked()
            ? server_->sendTrackedCommand({{"protocol", "phyvibe-v1"}, {"command_id", QUuid::createUuid().toString(QUuid::Id128)}, {"command", command_->text()}}, &code)
            : server_->sendCommand(command_->text(), &code);
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
        status_->setText("Start failed: " + error);
        monitor_->appendPlainText("ERR " + error);
        return false;
    }
    return true;
}

void BridgeWindow::updateState() {
    const bool running = server_->isRunning();
    start_->setEnabled(!running); stop_->setEnabled(running); send_->setEnabled(running);
    httpPort_->setEnabled(!running); tcpPort_->setEnabled(!running);
    status_->setText(running ? QString("Running — HTTP %1 / TCP %2").arg(server_->httpPort()).arg(server_->tcpPort()) : "Stopped — click Start server");
    const auto state = server_->status();
    clients_->setText("ESP32 command connections: " + QString::number(state.value("connected_clients").toInt()));
    latestRx_->setText("Latest RX (device → server): " + state.value("latest_message").toString());
    latestTx_->setText("Latest TX (server → device): " + state.value("latest_command").toString());
}
