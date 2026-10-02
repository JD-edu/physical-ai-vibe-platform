esp32wifiuart.start()

esp32wifiuart.onServerMessage(function () {
    basic.showString(
        esp32wifiuart.serverMessage()
    )
})

input.onButtonPressed(Button.A, function () {
    esp32wifiuart.sendLine("A")
})

input.onButtonPressed(Button.B, function () {
    esp32wifiuart.setupWiFi(
        "aicampus_286",
        "aicampus286!!"
    )
})
