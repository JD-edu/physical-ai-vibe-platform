/**
 * micro:bit P14/P15 UART를 이용해 ESP32와 통신하는 확장
 * - P14 = TX
 * - P15 = RX
 * - 9600bps
 *
 * ESP32 Wi-Fi/Server 기능과 TB6612FNG 모터 제어 기능을 함께 사용합니다.
 */
//% color=#1565c0 weight=100 icon="\uf1eb" block="ESP32 WiFi UART"
namespace esp32wifiuart {

    let lastServerMessage = ""
    let lastESP32Status = ""
    let started = false
    let initializingUART = false
    let activeBaud: BaudRate = BaudRate.BaudRate115200
    let receiverRegistered = false
    let serverMessageHandler: () => void = function () {}
    let acknowledgedIds: string[] = []
    let acknowledgedFrames: string[] = []

    /**
     * P14=TX, P15=RX, 9600bps로 UART를 시작하고
     * ESP32에 micro:bit 시작 신호를 보냅니다.
     */
    //% blockId=esp32wifiuart_start
    //% block="ESP32 시리얼 시작"
    //% weight=100
    export function start(): void {
        if (started) return
        startWithBaudRate(BaudRate.BaudRate9600)
    }

    /** Start UART at the same baud rate configured in the ESP32 firmware. */
    //% blockId=esp32wifiuart_start_baud
    //% block="ESP32 serial start baud %baud"
    //% weight=99
    export function startWithBaudRate(baud: BaudRate): void {
        // MakeCode fibers may enter startup during a pause. Only one may initialize UART.
        while (initializingUART) basic.pause(10)
        if (started && activeBaud == baud) return
        initializingUART = true
        activeBaud = baud
        serial.redirect(
            SerialPin.P14,
            SerialPin.P15,
            baud
        )

        serial.setRxBufferSize(128)
        started = true
        installReceiver()
        basic.pause(500)

        serial.writeLine("MB_START")
        basic.pause(2000)
        initializingUART = false
    }

    /**
     * ESP32에 micro:bit 시작 신호를 다시 보냅니다.
     */
    //% blockId=esp32wifiuart_send_start_signal
    //% block="ESP32 시작 신호 보내기"
    //% weight=95
    export function sendStartSignal(): void {
        ensureStarted()
        serial.writeLine("MB_START")
    }

    /**
     * 서버로 문자열을 보냅니다.
     */
    //% blockId=esp32wifiuart_send_line
    //% block="서버로 문자열 보내기 %text"
    //% text.defl="Hello"
    //% weight=90
    export function sendLine(text: string): void {
        ensureStarted()
        serial.writeLine(text)
    }

    /**
     * ESP32에 Wi-Fi SSID를 전달합니다.
     */
    //% blockId=esp32wifiuart_set_ssid
    //% block="WiFi SSID 설정 %ssid"
    //% ssid.defl="aicampus_286"
    //% weight=80
    export function setSSID(ssid: string): void {
        ensureStarted()
        serial.writeLine("SSID:" + ssid)
        basic.pause(200)
    }

    /**
     * ESP32에 Wi-Fi 비밀번호를 전달합니다.
     */
    //% blockId=esp32wifiuart_set_password
    //% block="WiFi 비밀번호 설정 %password"
    //% password.defl="password"
    //% weight=70
    export function setPassword(password: string): void {
        ensureStarted()
        serial.writeLine("PASSWORD:" + password)
        basic.pause(200)
    }

    /**
     * ESP32가 접속할 서버 IP를 전달합니다.
     */
    //% blockId=esp32wifiuart_set_server_ip
    //% block="서버 IP 설정 %ip"
    //% ip.defl="192.168.0.81"
    //% weight=65
    export function setServerIP(ip: string): void {
        ensureStarted()
        serial.writeLine("SERVER_IP:" + ip)
        basic.pause(200)
    }

    /**
     * 전달된 설정으로 Wi-Fi와 서버 연결을 시작합니다.
     */
    //% blockId=esp32wifiuart_connect_wifi
    //% block="WiFi와 서버 연결 시작"
    //% weight=60
    export function connectWiFi(): void {
        ensureStarted()
        serial.writeLine("CONNECT")
    }

    /**
     * SSID와 비밀번호를 전달하고 연결합니다.
     */
    //% blockId=esp32wifiuart_setup_wifi
    //% block="WiFi 연결 SSID %ssid 비밀번호 %password"
    //% ssid.defl="aicampus_286"
    //% password.defl="password"
    //% weight=85
    export function setupWiFi(ssid: string, password: string): void {
        ensureStarted()
        setSSID(ssid)
        setPassword(password)
        connectWiFi()
    }

    /**
     * SSID, 비밀번호, 서버 IP를 전달하고 연결합니다.
     */
    //% blockId=esp32wifiuart_setup_wifi_server
    //% block="WiFi와 서버 연결 SSID %ssid 비밀번호 %password 서버 IP %ip"
    //% ssid.defl="aicampus_286"
    //% password.defl="password"
    //% ip.defl="192.168.0.81"
    //% weight=84
    export function setupWiFiAndServer(ssid: string, password: string, ip: string): void {
        ensureStarted()
        setSSID(ssid)
        setPassword(password)
        setServerIP(ip)
        connectWiFi()
    }

    // ============================================================
    // Motor blocks
    // ESP32 protocol:
    // MOTOR:1:<speed>
    // MOTOR:2:<speed>
    // MOTOR:BOTH:<left>,<right>
    // MOTOR:STOP
    // speed range: -100 ~ 100
    // ============================================================

    /**
     * 모터 1의 속도를 설정합니다.
     * +100: 최대 정방향, -100: 최대 역방향, 0: 정지
     */
    //% blockId=esp32wifiuart_motor1_speed
    //% block="모터 1 속도 %speed"
    //% speed.min=-100 speed.max=100 speed.defl=50
    //% weight=58
    export function motor1Speed(speed: number): void {
        ensureStarted()
        speed = limitMotorSpeed(speed)
        serial.writeLine("MOTOR:1:" + speed)
    }

    /**
     * 모터 2의 속도를 설정합니다.
     * +100: 최대 정방향, -100: 최대 역방향, 0: 정지
     */
    //% blockId=esp32wifiuart_motor2_speed
    //% block="모터 2 속도 %speed"
    //% speed.min=-100 speed.max=100 speed.defl=50
    //% weight=57
    export function motor2Speed(speed: number): void {
        ensureStarted()
        speed = limitMotorSpeed(speed)
        serial.writeLine("MOTOR:2:" + speed)
    }

    /**
     * 모터 1과 모터 2의 속도를 동시에 설정합니다.
     */
    //% blockId=esp32wifiuart_motor_both_speed
    //% block="모터 동시 제어 모터1 %motor1 모터2 %motor2"
    //% motor1.min=-100 motor1.max=100 motor1.defl=50
    //% motor2.min=-100 motor2.max=100 motor2.defl=50
    //% weight=59
    export function motorBothSpeed(motor1: number, motor2: number): void {
        ensureStarted()

        motor1 = limitMotorSpeed(motor1)
        motor2 = limitMotorSpeed(motor2)

        serial.writeLine(
            "MOTOR:BOTH:" + motor1 + "," + motor2
        )
    }

    /**
     * 두 모터를 모두 정지합니다.
     */
    //% blockId=esp32wifiuart_motor_stop
    //% block="모터 모두 정지"
    //% weight=56
    export function motorStop(): void {
        ensureStarted()
        serial.writeLine("MOTOR:STOP")
    }

    /**
     * 전진합니다.
     */
    //% blockId=esp32wifiuart_motor_forward
    //% block="전진 속도 %speed"
    //% speed.min=0 speed.max=100 speed.defl=50
    //% weight=55
    export function forward(speed: number): void {
        ensureStarted()
        speed = Math.abs(limitMotorSpeed(speed))
        serial.writeLine("MOTOR:BOTH:" + speed + "," + speed)
    }

    /**
     * 후진합니다.
     */
    //% blockId=esp32wifiuart_motor_backward
    //% block="후진 속도 %speed"
    //% speed.min=0 speed.max=100 speed.defl=50
    //% weight=54
    export function backward(speed: number): void {
        ensureStarted()
        speed = Math.abs(limitMotorSpeed(speed))
        serial.writeLine("MOTOR:BOTH:" + (-speed) + "," + (-speed))
    }

    /**
     * 제자리에서 왼쪽으로 회전합니다.
     */
    //% blockId=esp32wifiuart_motor_turn_left
    //% block="왼쪽 회전 속도 %speed"
    //% speed.min=0 speed.max=100 speed.defl=50
    //% weight=53
    export function turnLeft(speed: number): void {
        ensureStarted()
        speed = Math.abs(limitMotorSpeed(speed))
        serial.writeLine("MOTOR:BOTH:" + (-speed) + "," + speed)
    }

    /**
     * 제자리에서 오른쪽으로 회전합니다.
     */
    //% blockId=esp32wifiuart_motor_turn_right
    //% block="오른쪽 회전 속도 %speed"
    //% speed.min=0 speed.max=100 speed.defl=50
    //% weight=52
    export function turnRight(speed: number): void {
        ensureStarted()
        speed = Math.abs(limitMotorSpeed(speed))
        serial.writeLine("MOTOR:BOTH:" + speed + "," + (-speed))
    }

    /**
     * ESP32에서 서버 문자열을 받았을 때 실행됩니다.
     */
    //% blockId=esp32wifiuart_on_server_message
    //% block="서버 문자열을 받았을 때"
    //% weight=50
    export function onServerMessage(handler: () => void): void {
        serverMessageHandler = handler
        ensureStarted()
    }

    // Always drain STATUS frames, including when a project only uses Wi-Fi setup blocks.
    // Register one UART event callback; adding/replacing a user handler must not duplicate it.
    function installReceiver(): void {
        if (receiverRegistered) return
        receiverRegistered = true
        serial.onDataReceived(
            serial.delimiters(Delimiters.NewLine),
            function () {
                let message = serial.readUntil(
                    serial.delimiters(Delimiters.NewLine)
                )
                if (message.charAt(message.length - 1) == "\r") {
                    message = message.substr(0, message.length - 1)
                }

                if (message.length == 0) {
                    return
                }

                // ESP32 내부 상태 메시지는 서버 메시지와 분리
                if (message.indexOf("STATUS:") == 0) {
                    lastESP32Status = message.substr(7)
                } else {
                    lastServerMessage = message
                    let id = protocolCommandId()
                    let cached = acknowledgedIds.indexOf(id)
                    if (id.length > 0 && cached >= 0) {
                        serial.writeLine(acknowledgedFrames[cached])
                        return
                    }
                    serverMessageHandler()
                }
            }
        )
    }

    /**
     * 마지막 서버 문자열을 반환합니다.
     */
    //% blockId=esp32wifiuart_server_message
    //% block="받은 서버 문자열"
    //% weight=45
    export function serverMessage(): string {
        return lastServerMessage
    }

    /**
     * ESP32의 마지막 상태 문자열을 반환합니다.
     */
    //% blockId=esp32wifiuart_esp32_status
    //% block="ESP32 연결 상태"
    //% weight=44
    export function esp32Status(): string {
        return lastESP32Status
    }

    /**
     * 마지막 서버 문자열을 LED에 표시합니다.
     */
    //% blockId=esp32wifiuart_show_server_message
    //% block="받은 서버 문자열 LED 표시"
    //% weight=40
    export function showServerMessage(): void {
        if (lastServerMessage.length > 0) {
            basic.showString(lastServerMessage)
        }
    }

    /**
     * 마지막 서버 문자열을 지웁니다.
     */
    //% blockId=esp32wifiuart_clear_server_message
    //% block="받은 서버 문자열 지우기"
    //% weight=30
    export function clearServerMessage(): void {
        lastServerMessage = ""
    }

    /**
     * ESP32의 Wi-Fi 및 서버 설정을 삭제합니다.
     */
    //% blockId=esp32wifiuart_clear_wifi
    //% block="ESP32 WiFi 설정 삭제"
    //% weight=20
    export function clearWiFi(): void {
        ensureStarted()
        motorStop()
        serial.writeLine("CLEAR")
    }

    /** Return the ID of the last v1 command; empty for legacy messages. */
    //% blockId=esp32wifiuart_protocol_id block="protocol v1 command ID"
    export function protocolCommandId(): string {
        let frame = lastServerMessage
        if (frame.indexOf("V1:CMD:") != 0) return ""
        let separator = frame.substr(7).indexOf(":")
        if (separator < 1) return ""
        let id = frame.substr(7, separator)
        return validProtocolKey(id) && id.length <= 32 ? id : ""
    }

    /** Return literal payload, including colons and spaces. */
    //% blockId=esp32wifiuart_protocol_payload block="protocol v1 command text"
    export function protocolCommandText(): string {
        let id = protocolCommandId()
        return id.length > 0 ? lastServerMessage.substr(8 + id.length) : lastServerMessage
    }

    /** Call only after the controller completed the requested operation. */
    //% blockId=esp32wifiuart_protocol_ok block="protocol v1 acknowledge success ID %id"
    export function acknowledgeCommand(id: string): void {
        replyProtocol(id, "OK")
    }

    /** Report a controller error; code uses uppercase letters, digits and underscores. */
    //% blockId=esp32wifiuart_protocol_error block="protocol v1 acknowledge error ID %id code %code"
    export function rejectCommand(id: string, code: string): void {
        if (code.length < 1 || code.length > 48) code = "DEVICE_ERROR"
        for (let i = 0; i < code.length; i++) {
            let c = code.charCodeAt(i)
            if (!((c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c == 95)) {
                code = "DEVICE_ERROR"
                break
            }
        }
        replyProtocol(id, "ERR:" + code)
    }

    /** Send numeric telemetry in the existing DATA:key:value format. */
    //% blockId=esp32wifiuart_sensor block="protocol sensor %key value %value"
    export function sendSensor(key: string, value: number): void {
        if (validProtocolKey(key)) sendLine("DATA:" + key + ":" + value)
    }

    function validProtocolKey(key: string): boolean {
        if (key.length < 1 || key.length > 32) return false
        for (let i = 0; i < key.length; i++) {
            let c = key.charCodeAt(i)
            if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) ||
                (c >= 48 && c <= 57) || c == 95 || c == 45)) return false
        }
        return true
    }

    function replyProtocol(id: string, result: string): void {
        if (!validProtocolKey(id)) return
        let frame = "V1:ACK:" + id + ":" + result
        let cached = acknowledgedIds.indexOf(id)
        if (cached < 0) {
            acknowledgedIds.push(id)
            acknowledgedFrames.push(frame)
            if (acknowledgedIds.length > 8) {
                acknowledgedIds.shift()
                acknowledgedFrames.shift()
            }
        } else {
            frame = acknowledgedFrames[cached]
        }
        sendLine(frame)
    }

    /** Logical servo targets used by Studio's set_servo skill. */
    export enum ServoTarget {
        //% block="servo"
        Servo = 0,
        //% block="valve"
        Valve = 1,
        //% block="mouth"
        Mouth = 2
    }

    let servoPins: AnalogPin[] = [AnalogPin.P0, AnalogPin.P0, AnalogPin.P0]
    let servoConfigured: boolean[] = [false, false, false]

    /** Bind a command target to an actual servo pin; no movement occurs here. */
    //% blockId=esp32wifiuart_configure_servo
    //% block="protocol servo configure %target pin %pin"
    //% pin.defl=AnalogPin.P0 weight=49
    export function configureServo(target: ServoTarget, pin: AnalogPin): void {
        if (target < 0 || target > 2) return
        // P14/P15 are reserved for the ESP32 UART.
        if (pin == AnalogPin.P14 || pin == AnalogPin.P15) return
        servoPins[target] = pin
        servoConfigured[target] = true
    }

    /** Apply an integer angle (0–180) to a configured target. Invalid values do not move the servo. */
    //% blockId=esp32wifiuart_servo_angle
    //% block="protocol servo %target angle %angle"
    //% angle.min=0 angle.max=180 angle.defl=90 weight=48
    export function setServoAngle(target: ServoTarget, angle: number): void {
        applyServoAngle(target, angle)
    }

    function applyServoAngle(target: ServoTarget, angle: number): boolean {
        if (target < 0 || target > 2 || !servoConfigured[target]) return false
        if (!(angle >= 0 && angle <= 180) || Math.round(angle) != angle) return false
        pins.servoWritePin(servoPins[target], angle)
        return true
    }

    /**
     * Put this block inside onServerMessage. It supports literal a and CMD:servo/valve/mouth:angle.
     * For v1 frames, success ACK follows PWM application or LED display completion.
     * Unknown v1 commands receive ERR; legacy commands have no ACK.
     */
    //% blockId=esp32wifiuart_execute_server_command
    //% block="execute received protocol command"
    //% weight=47
    export function executeServerCommand(): void {
        // Snapshot before showString (which yields) can allow another message to arrive.
        let id = protocolCommandId()
        let text = protocolCommandText()
        let error = "UNSUPPORTED_COMMAND"
        let done = false
        if (text == "a") {
            basic.showString("a")
            done = true
        } else if (text.indexOf("CMD:") == 0) {
            let fields = text.split(":")
            if (fields.length == 3) {
                let target = -1
                if (fields[1] == "servo") target = ServoTarget.Servo
                if (fields[1] == "valve") target = ServoTarget.Valve
                if (fields[1] == "mouth") target = ServoTarget.Mouth
                if (target >= 0) {
                    let angle = parseServoAngle(fields[2])
                    if (angle < 0) error = "INVALID_ANGLE"
                    else if (!servoConfigured[target]) error = "SERVO_NOT_CONFIGURED"
                    else done = applyServoAngle(target, angle)
                }
            }
        }
        if (id.length > 0) {
            if (done) acknowledgeCommand(id)
            else rejectCommand(id, error)
        }
    }

    /**
     * Read the angle for the selected target from the last received command.
     * Handles raw CMD:servo:134 and V1:CMD:id:CMD:servo:134 equally.
     * Returns -1 for another target, malformed text, or an angle outside 0–180.
     * Reading this block does not move a servo or send an ACK.
     */
    //% blockId=esp32wifiuart_received_servo_angle
    //% block="received %target angle"
    //% target.defl=ServoTarget.Servo weight=46
    export function receivedServoAngle(target: ServoTarget = ServoTarget.Servo): number {
        let name = ""
        if (target == ServoTarget.Servo) name = "servo"
        else if (target == ServoTarget.Valve) name = "valve"
        else if (target == ServoTarget.Mouth) name = "mouth"
        else return -1
        let fields = protocolCommandText().split(":")
        if (fields.length != 3 || fields[0] != "CMD" || fields[1] != name) return -1
        return parseServoAngle(fields[2])
    }

    /** True only when the received message contains a valid angle for this target. */
    //% blockId=esp32wifiuart_is_servo_command
    //% block="received valid %target command"
    //% target.defl=ServoTarget.Servo weight=45
    export function isServoCommand(target: ServoTarget = ServoTarget.Servo): boolean {
        return receivedServoAngle(target) >= 0
    }

    function parseServoAngle(text: string): number {
        if (text.length < 1 || text.length > 3) return -1
        let angle = 0
        for (let i = 0; i < text.length; i++) {
            let digit = text.charCodeAt(i) - 48
            if (digit < 0 || digit > 9) return -1
            angle = angle * 10 + digit
        }
        return angle <= 180 ? angle : -1
    }

    function limitMotorSpeed(speed: number): number {
        if (speed > 100) {
            return 100
        }

        if (speed < -100) {
            return -100
        }

        return Math.round(speed)
    }

    function ensureStarted(): void {
        while (initializingUART) basic.pause(10)
        if (!started) start()
    }
}