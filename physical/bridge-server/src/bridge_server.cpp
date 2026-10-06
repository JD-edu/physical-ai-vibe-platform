#include "bridge_server.h"
#include <QDateTime>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QRegularExpression>

namespace {
constexpr int maxBody = 16384;
constexpr int maxHeaders = 8192;
QString now() { return QDateTime::currentDateTime().toString("yyyy-MM-dd HH:mm:ss"); }
QByteArray json(const QJsonObject &object) { return QJsonDocument(object).toJson(QJsonDocument::Compact); }
}

BridgeServer::BridgeServer(QObject *parent) : QObject(parent) {
    connect(&httpServer_, &QTcpServer::newConnection, this, &BridgeServer::acceptHttp);
    connect(&tcpServer_, &QTcpServer::newConnection, this, &BridgeServer::acceptDevices);
    ackTimer_.setInterval(100);
    connect(&ackTimer_, &QTimer::timeout, this, &BridgeServer::expireCommands);
    ackTimer_.start();
    heartbeat_.setInterval(30000);
    connect(&heartbeat_, &QTimer::timeout, this, [this] {
        for (auto *device : devices_) device->write("\n");
    });
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
    emit packet("SYS", QString("Listening: HTTP %1, ESP32 TCP %2").arg(this->httpPort()).arg(this->tcpPort()));
    return true;
}

void BridgeServer::stop() {
    heartbeat_.stop();
    for (int i = 0; i < commands_.size(); ++i) {
        auto command = commands_[i].toObject();
        if (command.value("state") == "sent") { command["state"] = "connection_lost"; commands_[i] = command; }
    }
    httpServer_.close();
    tcpServer_.close();
    const auto http = httpClients_, devices = devices_;
    for (auto *socket : http) socket->abort();
    for (auto *socket : devices) socket->abort();
    emit runningChanged(false);
    emit packet("SYS", "Server stopped; network connections closed");
}

QJsonObject BridgeServer::status() const {
    return {{"server", "phyvibe-cpp-bridge"}, {"version", "2.1.0"},
            {"protocol", "phyvibe-v1"}, {"ack_timeout_ms", 5000}, {"commands", commands_}, {"running", isRunning()}, {"connected_clients", devices_.size()},
            {"latest_message", latestMessage_}, {"latest_time", latestTime_},
            {"latest_command", latestCommand_}, {"latest_command_time", latestCommandTime_},
            {"message_sequence", double(sequence_)}, {"message_history", history_}};
}

bool BridgeServer::validCommand(const QString &command) {
    return !command.trimmed().isEmpty() && command.toUcs4().size() <= 256 &&
           !command.contains('\r') && !command.contains('\n');
}

QJsonObject BridgeServer::sendCommand(const QString &command, int *httpStatus) {
    if (!validCommand(command)) {
        *httpStatus = 400;
        return {{"error", "A single command line of 1-256 characters is required"}};
    }
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

void BridgeServer::expireCommands() {
    for (int i = 0; i < commands_.size(); ++i) {
        auto command = commands_[i].toObject();
        if (command.value("state") == "sent" && QDateTime::currentMSecsSinceEpoch() >= command.value("deadline_ms").toDouble()) {
            command["state"] = "timed_out";
            command["error"] = "ACK_TIMEOUT_EXECUTION_UNKNOWN";
            commands_[i] = command;
            emit packet("ERR", "ACK timeout: " + command.value("command_id").toString());
        }
    }
}

QJsonObject BridgeServer::sendTrackedCommand(const QJsonObject &request, int *httpStatus) {
    const QString id = request.value("command_id").toString();
    const QString payload = request.value("command").toString();
    if (request.value("protocol") != "phyvibe-v1" || !QRegularExpression("^[A-Za-z0-9_-]{1,32}$").match(id).hasMatch() || !validCommand(payload) || !QRegularExpression("^[\\x20-\\x7e]{1,64}$").match(payload).hasMatch()) {
        *httpStatus = 400; return {{"error", "phyvibe-v1 requires command_id (1-32 ASCII letters/digits/_/-) and a valid command"}};
    }
    expireCommands();
    for (const auto &value : commands_) {
        const auto command = value.toObject();
        if (command.value("command_id") == id) {
            if (command.value("command") != payload) { *httpStatus = 409; return {{"error", "COMMAND_ID_CONFLICT"}}; }
            *httpStatus = 200; return command;
        }
    }
    if (devices_.size() != 1) { *httpStatus = devices_.isEmpty() ? 503 : 409; return {{"error", "Protocol v1 requires exactly one ESP32 command connection"}}; }
    if (commands_.size() >= 100) {
        int finished = -1;
        for (int i = commands_.size() - 1; i >= 0; --i) if (commands_[i].toObject().value("state") != "sent") { finished = i; break; }
        if (finished >= 0) commands_.removeAt(finished);
        else { *httpStatus = 503; return {{"error", "Too many pending commands"}}; }
    }
    auto *device = *devices_.begin();
    const QString frame = "V1:CMD:" + id + ":" + payload;
    if (device->write(frame.toUtf8() + '\n') < 0) { *httpStatus = 503; return {{"error", "Device connection unavailable"}}; }
    QJsonObject command{{"protocol", "phyvibe-v1"}, {"command_id", id}, {"command", payload}, {"state", "sent"}, {"sent_count", 1},
        {"peer", device->peerAddress().toString()}, {"deadline_ms", double(QDateTime::currentMSecsSinceEpoch() + 5000)}};
    commands_.prepend(command);
    latestCommand_ = payload; latestCommandTime_ = now();
    emit packet("TX", frame); emit stateChanged();
    *httpStatus = 202; return command;
}

void BridgeServer::receive(const QString &message, const QString &peer) {
    expireCommands();
    const auto ack = QRegularExpression("^V1:ACK:([A-Za-z0-9_-]{1,32}):(OK|ERR)(?::([A-Z0-9_]{1,48}))?$").match(message);
    if (ack.hasMatch() && ((ack.captured(2) == "OK" && ack.captured(3).isEmpty()) || (ack.captured(2) == "ERR" && !ack.captured(3).isEmpty()))) {
        for (int i = 0; i < commands_.size(); ++i) {
            auto command = commands_[i].toObject();
            if (command.value("command_id") == ack.captured(1) && command.value("peer") == peer && command.value("state") == "sent") {
                command["state"] = ack.captured(2) == "OK" ? "acknowledged" : "failed";
                command["error"] = ack.captured(3); commands_[i] = command;
                emit packet("ACK", message); break;
            }
        }
    }
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
        devices_.insert(socket);
        socket->setProperty("peer", socket->peerAddress().toString());
        emit clientsChanged(devices_.size());
        emit packet("SYS", "ESP32 connected: " + socket->peerAddress().toString());
        connect(socket, &QTcpSocket::disconnected, this, [this, socket] {
            devices_.remove(socket);
            for (int i = 0; i < commands_.size(); ++i) {
                auto command = commands_[i].toObject();
                if (command.value("state") == "sent" && command.value("peer") == socket->property("peer").toString()) { command["state"] = "connection_lost"; commands_[i] = command; }
            }
            emit clientsChanged(devices_.size());
            emit packet("SYS", "ESP32 disconnected");
            socket->deleteLater();
        });
        connect(socket, &QTcpSocket::readyRead, this, [this, socket] {
            QByteArray data = socket->property("buffer").toByteArray() + socket->readAll();
            if (data.size() > maxBody) { socket->abort(); return; }
            int newline;
            while ((newline = data.indexOf('\n')) >= 0) {
                const QString line = QString::fromUtf8(data.left(newline)).trimmed();
                data.remove(0, newline + 1);
                if (!line.isEmpty()) receive(line, socket->peerAddress().toString());
            }
            socket->setProperty("buffer", data);
        });
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
    if (method == "OPTIONS") { respond(socket, 204, {}); return; }
    if (method == "GET" && (path == "/api/status" || path == "/api/health")) { respond(socket, 200, json(status())); return; }
    if (method == "GET" && path.startsWith("/api/commands/")) {
        expireCommands();
        const QString id = QString::fromUtf8(path.mid(14));
        for (const auto &value : commands_) if (value.toObject().value("command_id") == id) { respond(socket, 200, json(value.toObject())); return; }
        respond(socket, 404, json({{"error", "UNKNOWN_COMMAND_ID"}})); return;
    }
    if (method == "POST" && path == "/api/command") {
        QJsonParseError error;
        const auto document = QJsonDocument::fromJson(body, &error);
        const auto command = document.object().value("command");
        if (error.error != QJsonParseError::NoError || !document.isObject() || !command.isString()) {
            respond(socket, 400, json({{"error", "JSON object with string command required"}})); return;
        }
        int code;
        const auto result = document.object().contains("protocol")
            ? sendTrackedCommand(document.object(), &code) : sendCommand(command.toString(), &code);
        respond(socket, code, json(result)); return;
    }
    if (method == "POST" && (path == "/receive" || path == "/exchange")) {
        const QString message = QString::fromUtf8(body).trimmed();
        if (message.isEmpty()) { respond(socket, 400, "EMPTY_DATA", "text/plain; charset=utf-8"); return; }
        receive(message, socket->peerAddress().toString());
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
