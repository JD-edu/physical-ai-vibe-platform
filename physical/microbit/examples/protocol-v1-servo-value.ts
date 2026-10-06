// Numeric value blocks let your own MakeCode logic decide how to use server angles.
// Add the updated ESP32 WiFi UART extension first; replace the network settings.
esp32wifiuart.startWithBaudRate(BaudRate.BaudRate115200)
esp32wifiuart.onServerMessage(function () {
    // Capture ID and angle before doing anything that may yield.
    let id = esp32wifiuart.protocolCommandId()
    if (esp32wifiuart.isServoCommand(esp32wifiuart.ServoTarget.Servo)) {
        let angle = esp32wifiuart.receivedServoAngle(esp32wifiuart.ServoTarget.Servo)
        // CMD:servo:134 makes angle equal to 134. Choose your actual signal pin here.
        pins.servoWritePin(AnalogPin.P0, angle)
        if (id.length > 0) esp32wifiuart.acknowledgeCommand(id)
    } else {
        // Handles a display request, or reports invalid/unsupported commands.
        esp32wifiuart.executeServerCommand()
    }
})
esp32wifiuart.setupWiFiAndServer("YOUR_SSID", "YOUR_PASSWORD", "YOUR_SERVER_LAN_IP")
basic.forever(function () {
    esp32wifiuart.sendSensor("temperature", input.temperature())
    basic.pause(2000)
})
