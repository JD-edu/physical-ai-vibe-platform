// Add this repository's ESP32 WiFi UART extension in MakeCode first.
// Replace these network settings with your own values.
esp32wifiuart.start()
esp32wifiuart.onServerMessage(function () {
    // Capture both values before an operation that yields (e.g. showString).
    let id = esp32wifiuart.protocolCommandId()
    let text = esp32wifiuart.protocolCommandText()
    if (text == "a") {
        basic.showString("a")
        if (id.length > 0) esp32wifiuart.acknowledgeCommand(id)
    } else if (id.length > 0) {
        esp32wifiuart.rejectCommand(id, "UNSUPPORTED_COMMAND")
    }
})
esp32wifiuart.setupWiFiAndServer("YOUR_SSID", "YOUR_PASSWORD", "YOUR_SERVER_LAN_IP")
basic.forever(function () {
    esp32wifiuart.sendSensor("temperature", input.temperature())
    basic.pause(2000)
})
