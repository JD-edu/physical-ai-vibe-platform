#pragma once
#include <QHostAddress>
#include <QElapsedTimer>
#include <QHash>
#include <QJsonObject>
#include <QJsonArray>
#include <QObject>
#include <QSet>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTimer>

class BridgeServer : public QObject {
    Q_OBJECT
public:
    explicit BridgeServer(QObject *parent = nullptr, int probeIntervalMs = 2000, int probeTimeoutMs = 6000, int webIdleMs = 5000);
    ~BridgeServer() override;
    bool start(const QHostAddress &address, quint16 httpPort, quint16 tcpPort, QString *error);
    void stop();
    bool isRunning() const { return httpServer_.isListening() && tcpServer_.isListening(); }
    quint16 httpPort() const { return httpServer_.serverPort(); }
    quint16 tcpPort() const { return tcpServer_.serverPort(); }
    QJsonObject status() const;
    QJsonObject sendCommand(const QString &command, int *httpStatus);
    static bool validCommand(const QString &command);
signals:
    void runningChanged(bool running);
    void clientsChanged(int count);
    void packet(const QString &direction, const QString &message);
    void stateChanged();
    void webActivity();
    void networkEvent(const QJsonObject &event);
private:
    struct DeviceLink {
        QString peer, deviceId, nonce;
        quint16 port = 0;
        bool managed = false, waiting = false;
        qint64 lastRx = 0, lastPong = -1, deadline = 0, nextProbe = 0;
    };
    void maintainLinks();
    void markWebActivity();
    void recordNetworkEvent(const QString &type, const QString &peer, const QString &reason);
    void closeDevice(QTcpSocket *socket, const QString &reason);
    bool receiveLinkFrame(QTcpSocket *socket, const QString &line);
    void acceptHttp();
    void acceptDevices();
    void readHttp(QTcpSocket *socket);
    void route(QTcpSocket *socket, const QByteArray &method, const QByteArray &path, const QByteArray &body);
    void respond(QTcpSocket *socket, int code, const QByteArray &body, const QByteArray &contentType = "application/json; charset=utf-8");
    void receive(const QString &message);
    QTcpServer httpServer_, tcpServer_;
    QSet<QTcpSocket *> httpClients_, devices_;
    QTimer heartbeat_;
    QElapsedTimer clock_;
    QHash<QTcpSocket *, DeviceLink> links_;
    QJsonArray networkEvents_;
    qint64 networkSequence_ = 0, probeSequence_ = 0, lastWebActivity_ = -1;
    bool webActive_ = false;
    int probeIntervalMs_, probeTimeoutMs_, webIdleMs_;
    QJsonArray history_;
    qint64 sequence_ = 0;
    QString latestMessage_, latestTime_, latestCommand_, latestCommandTime_;
};
