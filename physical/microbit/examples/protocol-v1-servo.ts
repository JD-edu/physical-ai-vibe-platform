// Add the updated ESP32 WiFi UART extension before using this example.
// Match ESP32 firmware baud (current platform firmware: 115200).
esp32wifiuart.startWithBaudRate(BaudRate.BaudRate115200)
// Change P0 to your actual servo signal pin. P14/P15 are reserved for UART.
esp32wifiuart.configureServo(esp32wifiuart.ServoTarget.Servo, AnalogPin.P0)
esp32wifiuart.onServerMessage(function () {
    esp32wifiuart.executeServerCommand()
})
esp32wifiuart.setupWiFiAndServer("YOUR_SSID", "YOUR_PASSWORD", "YOUR_SERVER_LAN_IP")
basic.forever(function () {
    esp32wifiuart.sendSensor("temperature", input.temperature())
    basic.pause(2000)
})
