#include "bridge_server.h"
#include <QDateTime>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QRegularExpression>
#ifdef Q_OS_LINUX
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <sys/socket.h>
#endif

namespace {
constexpr int maxBody = 16384;
constexpr int maxHeaders = 8192;
QString now() { return QDateTime::currentDateTime().toString("yyyy-MM-dd HH:mm:ss"); }
QByteArray json(const QJsonObject &object) { return QJsonDocument(object).toJson(QJsonDocument::Compact); }
}

BridgeServer::BridgeServer(QObject *parent, int probeIntervalMs, int probeTimeoutMs, int webIdleMs)
    : QObject(parent), probeIntervalMs_(qMax(20, probeIntervalMs)),
      probeTimeoutMs_(qMax(50, probeTimeoutMs)), webIdleMs_(qMax(50, webIdleMs)) {
    clock_.start();
    connect(&httpServer_, &QTcpServer::newConnection, this, &BridgeServer::acceptHttp);
    connect(&tcpServer_, &QTcpServer::newConnection, this, &BridgeServer::acceptDevices);
    heartbeat_.setInterval(qMin(250, probeIntervalMs_));
    connect(&heartbeat_, &QTimer::timeout, this, &BridgeServer::maintainLinks);
}

// Abort sockets while connection containers are still alive; accepted sockets
// otherwise outlive those members during QTcpServer destruction.
BridgeServer::~BridgeServer() { stop(); }

void BridgeServer::recordNetworkEvent(const QString &type, const QString &peer, const QString &reason) {
    const QJsonObject event{{"id", double(++networkSequence_)}, {"time", now()},
        {"type", type}, {"peer", peer}, {"reason", reason}};
    networkEvents_.prepend(event);
    while (networkEvents_.size() > 100) networkEvents_.removeLast();
    emit networkEvent(event);
    emit packet("NET", type + (peer.isEmpty() ? "" : " · " + peer) + " · " + reason);
    emit stateChanged();
}

void BridgeServer::markWebActivity() {
    lastWebActivity_ = clock_.elapsed();
    if (!webActive_) {
        webActive_ = true;
        recordNetworkEvent("web_active", "", "웹앱 HTTP 통신 시작");
    }
    emit webActivity();
}

void BridgeServer::closeDevice(QTcpSocket *socket, const QString &reason) {
    if (!devices_.contains(socket)) return;
    socket->setProperty("disconnectReason", reason);
    socket->abort();
}

bool BridgeServer::receiveLinkFrame(QTcpSocket *socket, const QString &line) {
    const QString hello = "PHYVIBE_LINK_HELLO:";
    const QString pong = "PHYVIBE_LINK_PONG:";
    if (line.startsWith(hello)) {
        const QString id = line.mid(hello.size());
        if (!QRegularExpression("^[A-Za-z0-9_:-]{1,64}$").match(id).hasMatch()) return true;
        const auto sockets = devices_;
        for (auto *other : sockets) {
            if (other != socket && links_.value(other).managed && links_.value(other).deviceId == id)
                closeDevice(other, "같은 장치의 새 연결로 교체");
        }
        auto &link = links_[socket];
        link.managed = true; link.deviceId = id;
        // Repeated hello frames must not extend an unanswered probe deadline.
        if (!link.waiting) link.nextProbe = clock_.elapsed();
        emit stateChanged();
        maintainLinks();
        return true;
    }
    if (line.startsWith(pong)) {
        auto &link = links_[socket];
        if (link.managed && link.waiting && line.mid(pong.size()) == link.nonce) {
            const bool first = link.lastPong < 0;
            link.lastPong = clock_.elapsed(); link.waiting = false;
            link.nextProbe = link.lastPong + probeIntervalMs_;
            if (first) recordNetworkEvent("device_online", link.peer, "ESP32 응답 확인 · " + link.deviceId);
            else emit stateChanged();
        }
        return true;
    }
    return line.startsWith("PHYVIBE_LINK_");
}

void BridgeServer::maintainLinks() {
    const qint64 time = clock_.elapsed();
    if (webActive_ && time - lastWebActivity_ >= webIdleMs_) {
        webActive_ = false;
        recordNetworkEvent("web_inactive", "", QString("최근 %1ms 동안 HTTP 통신 없음").arg(webIdleMs_));
    }
    const auto sockets = devices_;
    for (auto *socket : sockets) {
        if (!devices_.contains(socket)) continue;
        auto &link = links_[socket];
        if (link.managed && link.waiting && time >= link.deadline) {
            closeDevice(socket, QString("하트비트 무응답 (%1ms) · Wi-Fi/전원/프로그램 확인").arg(probeTimeoutMs_));
            continue;
        }
        if (time < link.nextProbe || link.waiting) continue;
        if (link.managed) {
            link.nonce = QString::number(++probeSequence_, 16);
            const QByteArray packet = "PHYVIBE_LINK_PING:" + link.nonce.toLatin1() + '\n';
            if (socket->write(packet) != packet.size()) { closeDevice(socket, "하트비트 송신 실패"); continue; }
            link.waiting = true; link.deadline = time + probeTimeoutMs_;
        } else {
            // Older firmware ignores empty lines. Do not send control-looking data
            // to micro:bit programs that have not negotiated link heartbeats.
            if (socket->write("\n") != 1) { closeDevice(socket, "TCP 상태 확인 송신 실패"); continue; }
        }
        link.nextProbe = time + probeIntervalMs_;
    }
}

bool BridgeServer::start(const QHostAddress &address, quint16 httpPort, quint16 tcpPort, QString *error) {
    if (isRunning()) return true;
    if (!httpServer_.listen(address, httpPort)) {
        *error = QString("HTTP port %1: %2").arg(httpPort).arg(httpServer_.errorString());
        return false;
    }
    if (!tcpServer_.listen(address, tcpPort)) {
        *error = QString("ESP32 TCP port %1: %2").arg(tcpPort).arg(tcpServer_.errorString());
        httpServer_.close();
        return false;
    }
    heartbeat_.start();
    emit runningChanged(true);
    recordNetworkEvent("server_started", "", "HTTP/TCP 서버 시작");
    emit packet("SYS", QString("Listening: HTTP %1, ESP32 TCP %2").arg(this->httpPort()).arg(this->tcpPort()));
    return true;
}

void BridgeServer::stop() {
    if (!httpServer_.isListening() && !tcpServer_.isListening() && devices_.isEmpty() && httpClients_.isEmpty()) return;
    heartbeat_.stop();
    httpServer_.close();
    tcpServer_.close();
    const auto http = httpClients_, devices = devices_;
    for (auto *socket : http) socket->abort();
    for (auto *socket : devices) closeDevice(socket, "서버 중지");
    if (webActive_) { webActive_ = false; recordNetworkEvent("web_inactive", "", "서버 중지"); }
    lastWebActivity_ = -1;
    emit runningChanged(false);
    recordNetworkEvent("server_stopped", "", "HTTP/TCP 서버 중지");
    emit packet("SYS", "Server stopped; network connections closed");
}

QJsonObject BridgeServer::status() const {
    QJsonArray devices;
    int healthy = 0;
    const qint64 time = clock_.elapsed();
    for (auto *socket : devices_) {
        const auto link = links_.value(socket);
        const bool verified = link.managed && link.lastPong >= 0;
        if (verified) ++healthy;
        devices.append(QJsonObject{{"peer", link.peer}, {"port", link.port}, {"device_id", link.deviceId},
            {"state", verified ? "online" : link.managed ? "checking" : "tcp_connected"},
            {"link_mode", link.managed ? "heartbeat" : "legacy_tcp"},
            {"last_rx_age_ms", double(time - link.lastRx)},
            {"last_pong_age_ms", link.lastPong >= 0 ? double(time - link.lastPong) : -1.0},
            {"awaiting_pong", link.waiting}});
    }
    return {{"server", "phyvibe-cpp-bridge"}, {"version", "2.1.0"},
            {"running", isRunning()}, {"connected_clients", devices_.size()},
            {"healthy_clients", healthy}, {"devices", devices}, {"network_events", networkEvents_},
            {"web_active", webActive_}, {"web_idle_timeout_ms", webIdleMs_},
            {"heartbeat_interval_ms", probeIntervalMs_}, {"heartbeat_timeout_ms", probeTimeoutMs_},
            {"latest_message", latestMessage_}, {"latest_time", latestTime_},
            {"latest_command", latestCommand_}, {"latest_command_time", latestCommandTime_},
            {"message_sequence", double(sequence_)}, {"message_history", history_}};
}

bool BridgeServer::validCommand(const QString &command) {
    return !command.trimmed().isEmpty() && command.toUcs4().size() <= 256 &&
           !command.contains('\r') && !command.contains('\n') && !command.startsWith("PHYVIBE_LINK_");
}

QJsonObject BridgeServer::sendCommand(const QString &command, int *httpStatus) {
    if (!validCommand(command)) {
        *httpStatus = 400;
        return {{"error", "A single command line of 1-256 characters is required"}};
    }
    maintainLinks();
    int sent = 0;
    const QByteArray data = command.toUtf8() + '\n';
    for (auto *device : devices_) {
        if (device->state() == QAbstractSocket::ConnectedState && device->write(data) == data.size()) ++sent;
    }
    if (!sent) {
        *httpStatus = 503;
        emit packet("ERR", "Command failed: no ESP32 command connection");
        return {{"error", "No ESP32 command connection is available"}, {"sent_count", 0}};
    }
    latestCommand_ = command;
    latestCommandTime_ = now();
    emit packet("TX", command);
    emit stateChanged();
    *httpStatus = 200;
    return {{"command", command}, {"sent_count", sent}};
}

void BridgeServer::receive(const QString &message) {
    latestMessage_ = message;
    latestTime_ = now();
    history_.prepend(QJsonObject{{"id", double(++sequence_)}, {"time", latestTime_}, {"message", message}});
    while (history_.size() > 20) history_.removeLast();
    emit packet("RX", message);
    emit stateChanged();
}

void BridgeServer::acceptDevices() {
    while (tcpServer_.hasPendingConnections()) {
        auto *socket = tcpServer_.nextPendingConnection();
        socket->setSocketOption(QAbstractSocket::KeepAliveOption, 1);
        socket->setSocketOption(QAbstractSocket::LowDelayOption, 1);
#ifdef Q_OS_LINUX
        const int descriptor = int(socket->socketDescriptor());
        const int idle = 3, interval = 2, count = 3, timeout = 10000;
        setsockopt(descriptor, IPPROTO_TCP, TCP_KEEPIDLE, &idle, sizeof(idle));
        setsockopt(descriptor, IPPROTO_TCP, TCP_KEEPINTVL, &interval, sizeof(interval));
        setsockopt(descriptor, IPPROTO_TCP, TCP_KEEPCNT, &count, sizeof(count));
        setsockopt(descriptor, IPPROTO_TCP, TCP_USER_TIMEOUT, &timeout, sizeof(timeout));
#endif
        DeviceLink link;
        link.peer = socket->peerAddress().toString(); link.port = socket->peerPort();
        link.lastRx = clock_.elapsed(); link.nextProbe = link.lastRx + probeIntervalMs_;
        links_.insert(socket, link); devices_.insert(socket);
        connect(socket, &QTcpSocket::disconnected, this, [this, socket] {
            if (!devices_.remove(socket)) return;
            const auto link = links_.take(socket);
            const QString reason = socket->property("disconnectReason").toString();
            emit clientsChanged(devices_.size());
            recordNetworkEvent("device_disconnected", link.peer, reason.isEmpty() ? "장치 TCP 연결 종료" : reason);
            socket->deleteLater();
        });
        connect(socket, &QAbstractSocket::errorOccurred, this, [this, socket](QAbstractSocket::SocketError error) {
            if (!devices_.contains(socket)) return;
            if (error != QAbstractSocket::RemoteHostClosedError) {
                const auto peer = links_.value(socket).peer;
                socket->setProperty("disconnectReason", socket->errorString());
                recordNetworkEvent("device_error", peer, socket->errorString());
            }
        });
        connect(socket, &QTcpSocket::readyRead, this, [this, socket] {
            if (!devices_.contains(socket)) return;
            links_[socket].lastRx = clock_.elapsed();
            QByteArray data = socket->property("buffer").toByteArray() + socket->readAll();
            if (data.size() > maxBody) { closeDevice(socket, "수신 데이터 크기 초과"); return; }
            int newline;
            while ((newline = data.indexOf('\n')) >= 0) {
                const QString line = QString::fromUtf8(data.left(newline)).trimmed();
                data.remove(0, newline + 1);
                if (!line.isEmpty() && !receiveLinkFrame(socket, line)) receive(line);
                if (!devices_.contains(socket)) return;
            }
            socket->setProperty("buffer", data);
        });
        emit clientsChanged(devices_.size());
        recordNetworkEvent("device_connected", link.peer, "TCP 연결 수립 · 장치 응답 확인 대기");
    }
}

void BridgeServer::acceptHttp() {
    while (httpServer_.hasPendingConnections()) {
        auto *socket = httpServer_.nextPendingConnection();
        httpClients_.insert(socket);
        connect(socket, &QTcpSocket::readyRead, this, [this, socket] { readHttp(socket); });
        connect(socket, &QTcpSocket::disconnected, this, [this, socket] {
            httpClients_.remove(socket);
            socket->deleteLater();
        });
        QTimer::singleShot(10000, socket, [socket] { socket->abort(); });
    }
}

void BridgeServer::readHttp(QTcpSocket *socket) {
    if (socket->property("answered").toBool()) return;
    const QByteArray data = socket->property("buffer").toByteArray() + socket->readAll();
    socket->setProperty("buffer", data);
    const int end = data.indexOf("\r\n\r\n");
    if (end < 0) {
        if (data.size() > maxHeaders) respond(socket, 413, json({{"error", "Headers too large"}}));
        return;
    }
    if (end > maxHeaders || data.size() > maxHeaders + maxBody) {
        respond(socket, 413, json({{"error", "Request too large"}})); return;
    }
    const auto lines = data.left(end).split('\n');
    const auto request = lines.first().trimmed().split(' ');
    if (request.size() != 3 || !request[2].startsWith("HTTP/1.")) {
        respond(socket, 400, json({{"error", "Invalid request line"}})); return;
    }
    qint64 length = 0;
    bool hasLength = false;
    for (int i = 1; i < lines.size(); ++i) {
        const QByteArray line = lines[i].trimmed();
        const int colon = line.indexOf(':');
        if (colon < 1) { respond(socket, 400, json({{"error", "Invalid header"}})); return; }
        const auto name = line.left(colon).toLower();
        if (name == "transfer-encoding") { respond(socket, 400, json({{"error", "Chunked requests are not supported"}})); return; }
        if (name == "content-length") {
            bool ok = false;
            length = line.mid(colon + 1).trimmed().toLongLong(&ok);
            if (hasLength || !ok || length < 0) { respond(socket, 400, json({{"error", "Invalid content length"}})); return; }
            hasLength = true;
        }
    }
    if (length > maxBody) { respond(socket, 413, json({{"error", "Payload too large"}})); return; }
    if (request[0] == "POST" && !hasLength) { respond(socket, 411, json({{"error", "Content-Length required"}})); return; }
    if (data.size() < end + 4 + length) return;
    route(socket, request[0], request[1].split('?').first(), data.mid(end + 4, length));
}

void BridgeServer::route(QTcpSocket *socket, const QByteArray &method, const QByteArray &path, const QByteArray &body) {
    // HTTP is request-based: this indicates recent API activity, not a live browser session.
    if ((method == "GET" && path == "/api/status") ||
        (method == "POST" && path == "/api/command")) markWebActivity();
    if (method == "OPTIONS") { respond(socket, 204, {}); return; }
    if (method == "GET" && (path == "/api/status" || path == "/api/health")) { respond(socket, 200, json(status())); return; }
    if (method == "POST" && path == "/api/command") {
        QJsonParseError error;
        const auto document = QJsonDocument::fromJson(body, &error);
        const auto command = document.object().value("command");
        if (error.error != QJsonParseError::NoError || !document.isObject() || !command.isString()) {
            respond(socket, 400, json({{"error", "JSON object with string command required"}})); return;
        }
        int code;
        const auto result = sendCommand(command.toString(), &code);
        respond(socket, code, json(result)); return;
    }
    if (method == "POST" && (path == "/receive" || path == "/exchange")) {
        const QString message = QString::fromUtf8(body).trimmed();
        if (message.isEmpty()) { respond(socket, 400, "EMPTY_DATA", "text/plain; charset=utf-8"); return; }
        receive(message);
        respond(socket, 200, path == "/exchange" ? message.toUtf8() : QByteArray("OK"), "text/plain; charset=utf-8"); return;
    }
    if (method == "GET" && path == "/") {
        respond(socket, 200, "<!doctype html><html><meta charset='utf-8'><title>PHYVIBE C++ Bridge</title><h1>PHYVIBE C++ Bridge</h1><p>Use the standalone desktop window to start/stop the server and monitor RX/TX.</p><a href='/api/status'>Network status JSON</a></html>", "text/html; charset=utf-8"); return;
    }
    respond(socket, 404, json({{"error", "Unknown endpoint or method"}}));
}

void BridgeServer::respond(QTcpSocket *socket, int code, const QByteArray &body, const QByteArray &contentType) {
    socket->setProperty("answered", true);
    const QByteArray reason = code == 200 ? "OK" : code == 202 ? "Accepted" : code == 409 ? "Conflict" : code == 204 ? "No Content" : code == 400 ? "Bad Request" : code == 404 ? "Not Found" : code == 411 ? "Length Required" : code == 413 ? "Payload Too Large" : "Service Unavailable";
    QByteArray response = "HTTP/1.1 " + QByteArray::number(code) + " " + reason + "\r\n";
    response += "Content-Type: " + contentType + "\r\nContent-Length: " + QByteArray::number(body.size());
    response += "\r\nConnection: close\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\n\r\n";
    socket->write(response + body);
    socket->disconnectFromHost();
}
