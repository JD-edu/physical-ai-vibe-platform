#pragma once
#include "bridge_server.h"
#include <QWidget>
class QLabel;
class QCheckBox;
class QSpinBox;
class QPushButton;
class QPlainTextEdit;
class QLineEdit;
class BridgeWindow : public QWidget {
    Q_OBJECT
public:
    BridgeWindow(BridgeServer *server, const QHostAddress &address, int httpPort, int tcpPort);
    bool startServer();
private:
    void updateState();
    BridgeServer *server_;
    QHostAddress address_;
    QSpinBox *httpPort_, *tcpPort_;
    QPushButton *start_, *stop_, *send_;
    QLabel *status_, *latestRx_, *latestTx_, *clients_;
    QPlainTextEdit *monitor_;
    QLineEdit *command_;
    QCheckBox *acknowledged_;
};
