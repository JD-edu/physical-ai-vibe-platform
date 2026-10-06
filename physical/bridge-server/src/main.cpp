#include "bridge_server.h"
#include "bridge_window.h"
#include <QApplication>
#include <QCommandLineParser>
#include <QTextStream>
#include <QTimer>
#include <memory>

int main(int argc, char *argv[]) {
    bool headless = false;
    for (int i = 1; i < argc; ++i) if (QByteArray(argv[i]) == "--headless") headless = true;
    std::unique_ptr<QCoreApplication> app;
    if (headless) app = std::make_unique<QCoreApplication>(argc, argv);
    else app = std::make_unique<QApplication>(argc, argv);
    app->setApplicationName("phyvibe-bridge");
    app->setApplicationVersion("2.1.0");
    QCommandLineParser parser;
    parser.setApplicationDescription("Standalone PHYVIBE C++ bridge: HTTP sensors and ESP32 TCP commands");
    parser.addHelpOption(); parser.addVersionOption();
    parser.addOption({"headless", "Run without desktop UI; starts listening immediately"});
    parser.addOption({"auto-start", "Start listening when the desktop UI opens"});
    parser.addOption({"smoke-test", "Test GUI start/stop/restart, then exit"});
    parser.addOption({"port", "HTTP port (0 chooses a free port)", "port", "5000"});
    parser.addOption({"tcp-port", "ESP32 TCP port (0 chooses a free port)", "port", "5001"});
    parser.addOption({"host", "Bind IP address", "address", "0.0.0.0"});
    parser.process(*app);
    bool okHttp, okTcp;
    const int http = parser.value("port").toInt(&okHttp), tcp = parser.value("tcp-port").toInt(&okTcp);
    const QHostAddress address(parser.value("host"));
    if (!okHttp || !okTcp || http < 0 || http > 65535 || tcp < 0 || tcp > 65535 || address.isNull()) {
        QTextStream(stderr) << "Invalid IP address or port\n"; return 2;
    }
    BridgeServer server;
    QObject::connect(&server, &BridgeServer::packet, [](const QString &direction, const QString &message) {
        QTextStream(stdout) << direction << " " << message << Qt::endl;
    });
    QObject::connect(app.get(), &QCoreApplication::aboutToQuit, &server, &BridgeServer::stop);
    std::unique_ptr<BridgeWindow> window;
    if (headless) {
        QString error;
        if (!server.start(address, http, tcp, &error)) { QTextStream(stderr) << error << Qt::endl; return 1; }
    } else {
        window = std::make_unique<BridgeWindow>(&server, address, http, tcp);
        if (!parser.isSet("smoke-test")) window->show();
        if (parser.isSet("auto-start") && !window->startServer()) return 1;
        if (parser.isSet("smoke-test")) {
            QTimer::singleShot(0, [&] {
                bool success = window->startServer() && server.isRunning();
                server.stop(); success = success && !server.isRunning();
                success = success && window->startServer() && server.isRunning();
                server.stop();
                QTextStream(stdout) << (success ? "UI start/stop/restart passed" : "UI lifecycle failed") << Qt::endl;
                app->exit(success ? 0 : 1);
            });
        }
    }
    return app->exec();
}
