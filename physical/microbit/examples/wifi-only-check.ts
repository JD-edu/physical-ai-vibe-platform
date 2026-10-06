// Isolation test: Wi-Fi setup once; no servo, motor, telemetry loop, or repeated CONNECT.
// Add the updated extension, then replace these network settings.
esp32wifiuart.startWithBaudRate(BaudRate.BaudRate115200)
esp32wifiuart.setupWiFiAndServer("YOUR_SSID", "YOUR_PASSWORD", "YOUR_SERVER_LAN_IP")
