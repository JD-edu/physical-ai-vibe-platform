#include "camera_wifi_widget.h"
#include "camera_wifi_protocol.h"
#include <QApplication>
#include <QComboBox>
#include <QJsonDocument>
#include <QLabel>
#include <QLineEdit>
#include <QPushButton>
#include <QSignalSpy>
#include <QTest>
#include <fcntl.h>
#include <pty.h>
#include <unistd.h>
#include <vector>

class FakeCamera : public QObject {
public:
    int master = -1, slave = -1, updates = 0;
    QString path;
    QByteArray pending;
    camera_wifi::Credentials stored;
    bool wrongDevice = false;
    explicit FakeCamera() {
        char name[128];
        if (openpty(&master, &slave, name, nullptr, nullptr) != 0) qFatal("openpty failed");
        path = name; fcntl(master, F_SETFL, O_NONBLOCK);
        auto *reader = new QSocketNotifier(master, QSocketNotifier::Read, this);
        connect(reader, &QSocketNotifier::activated, this, [this] {
            char bytes[512]; const auto count = read(master, bytes, sizeof(bytes));
            if (count <= 0) return;
            pending.append(bytes, int(count));
            int end;
            while ((end = pending.indexOf('\n')) >= 0) {
                const QByteArray line = pending.left(end); pending.remove(0, end + 1);
                if (line == "CAMERA_WIFI_STATUS") reply("connected", "192.168.1.10");
                else {
                    camera_wifi::Credentials parsed;
                    if (!camera_wifi::parseSettings(line.constData(), parsed)) { reply("invalid_settings"); continue; }
                    stored = parsed; ++updates;
                    reply("connecting");
                    QTimer::singleShot(25, this, [this] { reply(std::strcmp(stored.ssid, "fail-network") == 0 ? "wifi_failed" : "connected", "192.168.1.20"); });
                }
            }
        });
        strcpy(stored.ssid, "existing-network"); strcpy(stored.password, "existing-password");
    }
    void reply(const QString &state, const QString &ip = "") {
        const QJsonObject status{{"device", wrongDevice ? "other-device" : "phyvibe-camera"}, {"protocol", 1},
            {"state", state}, {"ssid", QString::fromUtf8(stored.ssid)}, {"ip", ip},
            {"url", state == "connected" ? "http://" + ip + "/stream" : ""}};
        const auto packet = "boot log ignored\nCAMERA_WIFI " + QJsonDocument(status).toJson(QJsonDocument::Compact) + '\n';
        if (write(master, packet.constData(), 15) != 15) qFatal("PTY prefix write failed");
        QTimer::singleShot(5, this, [this, packet] { if (master >= 0 && write(master, packet.constData() + 15, size_t(packet.size() - 15)) != packet.size() - 15) qFatal("PTY status write failed"); });
    }
    ~FakeCamera() override { if (master >= 0) close(master); if (slave >= 0) close(slave); }
};

class MemoryStore {
public:
    std::vector<unsigned char> bytes;
    bool fail = false;
    bool begin(const char *, bool) { return true; }
    void end() {}
    size_t getBytesLength(const char *) { return bytes.size(); }
    size_t getBytes(const char *, void *to, size_t count) { if (bytes.size() != count) return 0; memcpy(to, bytes.data(), count); return count; }
    size_t putBytes(const char *, const void *from, size_t count) { if (fail) return 0; const auto *p = static_cast<const unsigned char *>(from); bytes.assign(p, p + count); return count; }
};

class CameraProvisionTest : public QObject {
    Q_OBJECT
private slots:
    void storagePriorityAndOverwrite() {
        MemoryStore memory;
        camera_wifi::Credentials fallback, loaded, updated;
        strcpy(fallback.ssid, "compiled-default"); strcpy(fallback.password, "default-password");
        bool saved = false;
        camera_wifi::Credentials empty;
        QVERIFY(!camera_wifi::loadCredentials(memory, empty, loaded, saved));
        QVERIFY(camera_wifi::loadCredentials(memory, fallback, loaded, saved)); QVERIFY(!saved);
        QCOMPARE(QByteArray(loaded.ssid), QByteArray("compiled-default"));
        strcpy(updated.ssid, "USB SSID"); strcpy(updated.password, "USB password");
        QVERIFY(camera_wifi::saveCredentials(memory, updated));
        QVERIFY(camera_wifi::loadCredentials(memory, fallback, loaded, saved)); QVERIFY(saved);
        QCOMPARE(QByteArray(loaded.ssid), QByteArray("USB SSID"));
        strcpy(updated.ssid, "second-network"); strcpy(updated.password, "second-password");
        QVERIFY(camera_wifi::saveCredentials(memory, updated));
        QVERIFY(camera_wifi::loadCredentials(memory, fallback, loaded, saved));
        QCOMPARE(QByteArray(loaded.ssid), QByteArray("second-network"));
        QCOMPARE(QByteArray(loaded.password), QByteArray("second-password"));
        const auto previous = memory.bytes;
        memory.fail = true; strcpy(updated.ssid, "rejected-save");
        QVERIFY(!camera_wifi::saveCredentials(memory, updated)); QVERIFY(previous == memory.bytes);
        QVERIFY(camera_wifi::loadCredentials(memory, fallback, loaded, saved));
        QCOMPARE(QByteArray(loaded.ssid), QByteArray("second-network"));
    }
    void rejectsMalformedPackets() {
        camera_wifi::Credentials value;
        for (const auto *packet : {"CAMERA_WIFI_SET 00 -", "CAMERA_WIFI_SET 414 -", "CAMERA_WIFI_SET zz -",
             "CAMERA_WIFI_SET 4142 31", "CAMERA_WIFI_SET 410a42 -", "CAMERA_WIFI_SET 4142 3132333435363738 extra"})
            QVERIFY(!camera_wifi::parseSettings(packet, value));
        QVERIFY(camera_wifi::parseSettings("CAMERA_WIFI_SET 412042 -", value));
        QCOMPARE(QByteArray(value.ssid), QByteArray("A B")); QCOMPARE(QByteArray(value.password), QByteArray());
    }
    void uiSendsAndUpdatesStoredSettings() {
        FakeCamera device;
        CameraWifiWidget widget;
        auto *port = widget.findChild<QComboBox *>("cameraSerialPort");
        auto *open = widget.findChild<QPushButton *>("cameraConnect");
        auto *ssid = widget.findChild<QLineEdit *>("cameraSsid");
        auto *password = widget.findChild<QLineEdit *>("cameraPassword");
        auto *save = widget.findChild<QPushButton *>("cameraSaveWifi");
        auto *url = widget.findChild<QLineEdit *>("cameraStreamUrl");
        auto *status = widget.findChild<QLabel *>("cameraWifiStatus");
        QVERIFY(port && open && ssid && password && save && url && status);
        QCOMPARE(password->echoMode(), QLineEdit::Password);
        port->setEditText(device.path); open->click();
        QTRY_VERIFY(save->isEnabled());
        QCOMPARE(url->text(), QString("http://192.168.1.10/stream"));
        ssid->setText(QString::fromUtf8("테스트 WiFi")); password->setText("pass with spaces"); save->click();
        QVERIFY(password->text().isEmpty());
        QTRY_COMPARE(device.updates, 1); QTRY_COMPARE(url->text(), QString("http://192.168.1.20/stream")); QTRY_VERIFY(save->isEnabled());
        QCOMPARE(QString::fromUtf8(device.stored.ssid), QString::fromUtf8("테스트 WiFi"));
        QCOMPARE(QByteArray(device.stored.password), QByteArray("pass with spaces"));
        QCOMPARE(url->text(), QString("http://192.168.1.20/stream"));
        widget.resize(780, 310); widget.show(); QTest::qWait(10);
        if (!qEnvironmentVariable("CAMERA_UI_CAPTURE").isEmpty()) QVERIFY(widget.grab().save(qEnvironmentVariable("CAMERA_UI_CAPTURE")));
        ssid->setText("second-network"); password->setText("new-password"); save->click();
        QTRY_COMPARE(device.updates, 2); QTRY_VERIFY(status->text().contains("연결 완료")); QTRY_VERIFY(save->isEnabled());
        QCOMPARE(QByteArray(device.stored.ssid), QByteArray("second-network"));
        ssid->setText("fail-network"); password->setText("wrong-password"); save->click();
        QTRY_COMPARE(device.updates, 3); QTRY_VERIFY(status->text().contains("다시 설정"));
        QVERIFY(save->isEnabled()); QVERIFY(url->text().isEmpty());
        password->setText("short"); save->click(); QCOMPARE(device.updates, 3);
        QVERIFY(status->text().contains("8~63"));
        open->click(); QVERIFY(!save->isEnabled());
    }
    void rejectsOtherDevices() {
        FakeCamera device; device.wrongDevice = true;
        CameraWifiSerial serial;
        QSignalSpy status(&serial, &CameraWifiSerial::cameraStatus);
        QString error; QVERIFY(serial.openPort(device.path, &error));
        QTest::qWait(80); QVERIFY(!serial.isCamera()); QCOMPARE(status.size(), 0);
        QVERIFY(!serial.sendSettings("network", "password123", &error));
        QCOMPARE(device.updates, 0);
        serial.closePort();
    }
};
QTEST_MAIN(CameraProvisionTest)
#include "camera_provision_test.moc"
