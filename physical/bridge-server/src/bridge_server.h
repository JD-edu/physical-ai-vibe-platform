#pragma once
#include <QHostAddress>
#include <QJsonArray>
#include <QObject>
#include <QSet>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTimer>

class BridgeServer : public QObject {
    Q_OBJECT
public:
    explicit BridgeServer(QObject *parent = nullptr);
    bool start(const QHostAddress &address, quint16 httpPort, quint16 tcpPort, QString *error);
    void stop();
    bool isRunning() const { return httpServer_.isListening() && tcpServer_.isListening(); }
    quint16 httpPort() const { return httpServer_.serverPort(); }
    quint16 tcpPort() const { return tcpServer_.serverPort(); }
    QJsonObject status() const;
    QJsonObject sendTrackedCommand(const QJsonObject &request, int *httpStatus);
    void expireCommands();
    QJsonObject sendCommand(const QString &command, int *httpStatus);
    static bool validCommand(const QString &command);
signals:
    void runningChanged(bool running);
    void clientsChanged(int count);
    void packet(const QString &direction, const QString &message);
    void stateChanged();
private:
    void acceptHttp();
    void acceptDevices();
    void readHttp(QTcpSocket *socket);
    void route(QTcpSocket *socket, const QByteArray &method, const QByteArray &path, const QByteArray &body);
    void respond(QTcpSocket *socket, int code, const QByteArray &body, const QByteArray &contentType = "application/json; charset=utf-8");
    void receive(const QString &message, const QString &peer);
    QTcpServer httpServer_, tcpServer_;
    QSet<QTcpSocket *> httpClients_, devices_;
    QTimer heartbeat_, ackTimer_;
    QJsonArray commands_;
    QJsonArray history_;
    qint64 sequence_ = 0;
    QString latestMessage_, latestTime_, latestCommand_, latestCommandTime_;
};
