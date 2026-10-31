#include "bridge_server.h"
#include "bridge_window.h"
#include <QJsonDocument>
#include <QSignalSpy>
#include <QTcpSocket>
#include <QTest>
#include <QTreeWidget>

class NetworkStateTest : public QObject {
    Q_OBJECT
    static bool eventPresent(const BridgeServer &server, const QString &type, const QString &reason = "") {
        for (const auto &value : server.status().value("network_events").toArray()) {
            const auto event = value.toObject();
            if (event.value("type") == type && (reason.isEmpty() || event.value("reason").toString().contains(reason))) return true;
        }
        return false;
    }
    static QByteArray takePing(QTcpSocket &client) {
        QByteArray token;
        while (client.canReadLine()) {
            const auto line = client.readLine().trimmed();
            if (line.startsWith("PHYVIBE_LINK_PING:")) token = line.mid(18);
        }
        return token;
    }
    static bool start(BridgeServer &server) {
        QString error; return server.start(QHostAddress::LocalHost, 0, 0, &error);
    }
private slots:
    void normalDisconnectRemovesDevice() {
        BridgeServer server(nullptr, 40, 180, 100); QVERIFY(start(server));
        QSignalSpy events(&server, &BridgeServer::networkEvent);
        QTcpSocket client; client.connectToHost(QHostAddress::LocalHost, server.tcpPort());
        QTRY_COMPARE(server.status().value("connected_clients").toInt(), 1);
        QCOMPARE(server.status().value("healthy_clients").toInt(), 0);
        QCOMPARE(server.status().value("devices").toArray().first().toObject().value("link_mode").toString(), QString("legacy_tcp"));
        client.disconnectFromHost();
        QTRY_COMPARE(server.status().value("connected_clients").toInt(), 0);
        QVERIFY(eventPresent(server, "device_disconnected")); QVERIFY(events.count() >= 2);
        server.stop();
    }
    void silentUnresponsiveDeviceTimesOutAndUpdatesUI() {
        BridgeServer server(nullptr, 40, 180, 100);
        BridgeWindow window(&server, QHostAddress::LocalHost, 0, 0); QVERIFY(window.startServer());
        auto *table = window.findChild<QTreeWidget *>("deviceLinkStatus"); QVERIFY(table);
        QTcpSocket client; client.connectToHost(QHostAddress::LocalHost, server.tcpPort());
        QTRY_COMPARE(server.status().value("connected_clients").toInt(), 1);
        client.write("PHYVIBE_LINK_HELLO:test-device\n");
        QTRY_VERIFY(client.peek(client.bytesAvailable()).contains("PHYVIBE_LINK_PING:") && client.peek(client.bytesAvailable()).endsWith("\n")); const auto token = takePing(client); QVERIFY(!token.isEmpty());
        client.write("PHYVIBE_LINK_PONG:" + token + '\n');
        QTRY_COMPARE(server.status().value("healthy_clients").toInt(), 1);
        QCOMPARE(table->topLevelItemCount(), 1); QCOMPARE(table->topLevelItem(0)->text(1), QString("응답 정상"));
        // Keep the socket open but stop replying: models an unreachable/hung ESP32
        // without FIN, rather than relying only on disconnected().
        QTRY_COMPARE_WITH_TIMEOUT(server.status().value("connected_clients").toInt(), 0, 2000);
        QCOMPARE(table->topLevelItemCount(), 0);
        auto *diagram = window.findChild<QWidget *>("connectionDiagram"); QVERIFY(diagram);
        QVERIFY(diagram->accessibleDescription().contains("ESP32 0대"));
        QVERIFY(eventPresent(server, "device_disconnected", "하트비트 무응답"));
        QVERIFY(server.status().value("message_history").toArray().isEmpty());
        int code; server.sendCommand("a", &code); QCOMPARE(code, 503);
        server.stop();
    }
    void wrongPongDoesNotKeepDeviceAlive() {
        BridgeServer server(nullptr, 40, 160); QVERIFY(start(server));
        QTcpSocket client; client.connectToHost(QHostAddress::LocalHost, server.tcpPort());
        QTRY_COMPARE(server.status().value("connected_clients").toInt(), 1);
        client.write("PHYVIBE_LINK_HELLO:bad-pong\n");
        QTRY_VERIFY(client.peek(client.bytesAvailable()).contains("PHYVIBE_LINK_PING:") && client.peek(client.bytesAvailable()).endsWith("\n")); QVERIFY(!takePing(client).isEmpty());
        client.write("PHYVIBE_LINK_PONG:wrong-token\n");
        QTRY_COMPARE_WITH_TIMEOUT(server.status().value("connected_clients").toInt(), 0, 2000);
        QVERIFY(eventPresent(server, "device_disconnected", "하트비트"));
    }
    void sameDeviceReconnectReplacesStaleSocket() {
        BridgeServer server(nullptr, 80, 800); QVERIFY(start(server));
        QTcpSocket old, replacement;
        old.connectToHost(QHostAddress::LocalHost, server.tcpPort());
        QTRY_COMPARE(server.status().value("connected_clients").toInt(), 1);
        old.write("PHYVIBE_LINK_HELLO:AA:BB:CC:DD:EE:FF\n"); QTRY_VERIFY(old.peek(old.bytesAvailable()).contains("PHYVIBE_LINK_PING:"));
        replacement.connectToHost(QHostAddress::LocalHost, server.tcpPort());
        QTRY_COMPARE(server.status().value("connected_clients").toInt(), 2);
        replacement.write("PHYVIBE_LINK_HELLO:AA:BB:CC:DD:EE:FF\n");
        QTRY_COMPARE(server.status().value("connected_clients").toInt(), 1);
        QTRY_COMPARE(old.state(), QAbstractSocket::UnconnectedState);
        QVERIFY(eventPresent(server, "device_disconnected", "새 연결"));
    }
    void healthyProbesAreNotTelemetryAndCommandsRemainRaw() {
        BridgeServer server(nullptr, 60, 500); QVERIFY(start(server));
        QTcpSocket client; client.connectToHost(QHostAddress::LocalHost, server.tcpPort());
        QTRY_COMPARE(server.status().value("connected_clients").toInt(), 1);
        client.write("PHYVIBE_LINK_HELLO:healthy\n");
        for (int i = 0; i < 3; ++i) {
            QTRY_VERIFY(client.peek(client.bytesAvailable()).contains("PHYVIBE_LINK_PING:") && client.peek(client.bytesAvailable()).endsWith("\n")); const auto token = takePing(client); QVERIFY(!token.isEmpty());
            client.write("PHYVIBE_LINK_PONG:" + token + '\n');
            QTRY_COMPARE(server.status().value("healthy_clients").toInt(), 1);
        }
        QVERIFY(server.status().value("message_history").toArray().isEmpty());
        int code; server.sendCommand("CMD:motor:forward:50", &code); QCOMPARE(code, 200);
        QTRY_VERIFY(client.canReadLine());
        const auto command = client.readAll(); QVERIFY(command.contains("CMD:motor:forward:50\n"));
        QVERIFY(!BridgeServer::validCommand("PHYVIBE_LINK_PING:fake"));
    }
    void legacyClientsOnlyReceiveBlankProbes() {
        BridgeServer server(nullptr, 40, 100); QVERIFY(start(server));
        QTcpSocket client; client.connectToHost(QHostAddress::LocalHost, server.tcpPort());
        QTRY_COMPARE(server.status().value("connected_clients").toInt(), 1);
        QTest::qWait(200);
        QCOMPARE(server.status().value("connected_clients").toInt(), 1);
        const auto data = client.readAll(); QVERIFY(!data.isEmpty()); QVERIFY(data.trimmed().isEmpty());
    }
    void webIdleEmitsEventAndServerStopClearsState() {
        BridgeServer server(nullptr, 20, 200, 100); QVERIFY(start(server));
        QTcpSocket web; web.connectToHost(QHostAddress::LocalHost, server.httpPort());
        QTRY_COMPARE(web.state(), QAbstractSocket::ConnectedState);
        web.write("GET /api/status HTTP/1.1\r\nHost: localhost\r\n\r\n");
        QTRY_VERIFY(server.status().value("web_active").toBool());
        QVERIFY(eventPresent(server, "web_active"));
        QTRY_VERIFY(!server.status().value("web_active").toBool());
        QVERIFY(eventPresent(server, "web_inactive"));
        server.stop(); QVERIFY(!server.status().value("running").toBool());
        QVERIFY(eventPresent(server, "server_stopped"));
    }
};
QTEST_MAIN(NetworkStateTest)
#include "network_state_test.moc"
