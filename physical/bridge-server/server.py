from flask import (
    Flask,
    request,
    render_template_string,
    redirect,
    url_for,
    jsonify
)
from datetime import datetime
from threading import Lock, Thread
import socket

app = Flask(__name__)

# ==================================================
# 설정
# ==================================================

FLASK_PORT = 5000
TCP_PORT = 5001

# ==================================================
# 수신 데이터
# ==================================================

latest_message = "아직 수신된 데이터가 없습니다."
latest_time = "-"

message_history = []

# 마지막으로 서버에서 보낸 명령
latest_command = "없음"
latest_command_time = "-"

data_lock = Lock()

# 연결된 ESP32 TCP 소켓 목록
esp32_clients = []
clients_lock = Lock()

# ==================================================
# 웹페이지
# ==================================================

HTML_PAGE = """
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">

    <meta name="viewport"
          content="width=device-width, initial-scale=1.0">

    <title>ESP32 양방향 통신 서버</title>

    <style>
        body {
            font-family: Arial, sans-serif;
            background-color: #f2f4f7;
            margin: 0;
            padding: 20px;
        }

        .container {
            max-width: 750px;
            margin: 30px auto;
        }

        h1 {
            color: #1565c0;
            text-align: center;
        }

        .card {
            background-color: white;
            margin-bottom: 20px;
            padding: 25px;
            border-radius: 15px;
            box-shadow:
                0 4px 12px rgba(0, 0, 0, 0.12);
        }

        .value-box {
            padding: 20px;
            border-radius: 10px;
            background-color: #e8f5e9;
            font-size: 36px;
            font-weight: bold;
            text-align: center;
            word-break: break-all;
        }

        .command-box {
            padding: 20px;
            border-radius: 10px;
            background-color: #e3f2fd;
            font-size: 36px;
            font-weight: bold;
            text-align: center;
            word-break: break-all;
        }

        form {
            display: flex;
            gap: 10px;
            margin-top: 20px;
        }

        input {
            flex: 1;
            min-width: 0;
            padding: 14px;
            border: 1px solid #cccccc;
            border-radius: 8px;
            font-size: 22px;
        }

        button {
            padding: 14px 22px;
            border: none;
            border-radius: 8px;
            background-color: #1565c0;
            color: white;
            font-size: 17px;
            cursor: pointer;
        }

        button:hover {
            background-color: #0d47a1;
        }

        .time {
            margin-top: 10px;
            color: #555555;
        }

        .status {
            margin-top: 10px;
            color: #1565c0;
            font-weight: bold;
        }

        .update-status {
            margin-top: 10px;
            font-size: 13px;
            color: #777777;
        }

        table {
            width: 100%;
            border-collapse: collapse;
        }

        th,
        td {
            padding: 12px;
            border-bottom: 1px solid #dddddd;
            text-align: left;
        }

        th {
            background-color: #eeeeee;
        }

        @media (max-width: 600px) {
            body {
                padding: 10px;
            }

            .container {
                margin: 10px auto;
            }

            .card {
                padding: 18px;
            }

            form {
                flex-direction: column;
            }

            button {
                width: 100%;
            }
        }
    </style>
</head>

<body>
    <div class="container">

        <h1>ESP32 양방향 통신 서버</h1>

        <div class="card">
            <h2>마이크로비트로 문자 보내기</h2>

            <div
                class="command-box"
                id="latest-command"
            >
                {{ latest_command }}
            </div>

            <div class="time">
                전송 시간:
                <span id="latest-command-time">
                    {{ latest_command_time }}
                </span>
            </div>

            <div class="status">
                연결된 ESP32:
                <span id="connected-clients">
                    {{ connected_clients }}
                </span>대
            </div>

            <form
                method="post"
                action="/send-command"
            >
                <input
                    type="text"
                    name="command"
                    maxlength="20"
                    placeholder="보낼 문자 또는 문자열"
                    required
                    autofocus
                >

                <button type="submit">
                    즉시 전송
                </button>
            </form>
        </div>

        <div class="card">
            <h2>마이크로비트에서 받은 데이터</h2>

            <div
                class="value-box"
                id="latest-message"
            >
                {{ latest_message }}
            </div>

            <div class="time">
                수신 시간:
                <span id="latest-time">
                    {{ latest_time }}
                </span>
            </div>

            <div
                class="update-status"
                id="update-status"
            >
                자동 업데이트 준비 중
            </div>
        </div>

        <div class="card">
            <h2>수신 기록</h2>

            <table>
                <thead>
                    <tr>
                        <th>시간</th>
                        <th>데이터</th>
                    </tr>
                </thead>

                <tbody id="history-body">
                    {% for item in message_history %}
                    <tr>
                        <td>{{ item.time }}</td>
                        <td>{{ item.message }}</td>
                    </tr>
                    {% endfor %}
                </tbody>
            </table>
        </div>

    </div>

    <script>
        async function updateStatus() {
            const updateStatusElement =
                document.getElementById("update-status");

            try {
                const response = await fetch(
                    "/api/status",
                    {
                        method: "GET",
                        cache: "no-store"
                    }
                );

                if (!response.ok) {
                    throw new Error(
                        "HTTP 오류: " + response.status
                    );
                }

                const data = await response.json();

                document.getElementById(
                    "latest-message"
                ).textContent = data.latest_message;

                document.getElementById(
                    "latest-time"
                ).textContent = data.latest_time;

                document.getElementById(
                    "latest-command"
                ).textContent = data.latest_command;

                document.getElementById(
                    "latest-command-time"
                ).textContent =
                    data.latest_command_time;

                document.getElementById(
                    "connected-clients"
                ).textContent =
                    data.connected_clients;

                const historyBody =
                    document.getElementById(
                        "history-body"
                    );

                historyBody.innerHTML = "";

                data.message_history.forEach(
                    function(item) {
                        const row =
                            document.createElement("tr");

                        const timeCell =
                            document.createElement("td");

                        const messageCell =
                            document.createElement("td");

                        timeCell.textContent = item.time;
                        messageCell.textContent =
                            item.message;

                        row.appendChild(timeCell);
                        row.appendChild(messageCell);

                        historyBody.appendChild(row);
                    }
                );

                const now = new Date();

                updateStatusElement.textContent =
                    "자동 업데이트 정상 · " +
                    now.toLocaleTimeString();

                updateStatusElement.style.color =
                    "#2e7d32";

            } catch (error) {
                console.error(
                    "자동 업데이트 실패:",
                    error
                );

                updateStatusElement.textContent =
                    "자동 업데이트 실패 · 서버 연결 확인";

                updateStatusElement.style.color =
                    "#c62828";
            }
        }

        // 페이지가 열리면 즉시 최신 데이터 요청
        updateStatus();

        // 1초마다 서버의 최신 데이터 요청
        setInterval(updateStatus, 1000);
    </script>
</body>
</html>
"""

# ==================================================
# 연결된 ESP32 개수
# ==================================================

def get_client_count():
    with clients_lock:
        return len(esp32_clients)


# ==================================================
# ESP32에 명령 전송
# ==================================================

def broadcast_command(command):
    """
    연결된 모든 ESP32에 명령을 즉시 보냅니다.
    ESP32는 줄바꿈을 기준으로 명령을 구분합니다.
    """

    packet = (command + "\n").encode("utf-8")
    disconnected_clients = []
    sent_count = 0

    with clients_lock:
        for client_socket in esp32_clients:
            try:
                client_socket.sendall(packet)
                sent_count += 1

            except (ConnectionError, OSError):
                disconnected_clients.append(
                    client_socket
                )

        for client_socket in disconnected_clients:
            if client_socket in esp32_clients:
                esp32_clients.remove(
                    client_socket
                )

            try:
                client_socket.close()
            except OSError:
                pass

    return sent_count, len(disconnected_clients)


# ==================================================
# ESP32 TCP 연결 처리
# ==================================================

def handle_esp32_client(
    client_socket,
    client_address
):
    print(
        "ESP32 TCP 연결:",
        client_address
    )

    # 끊어진 연결을 비교적 빠르게 감지
    client_socket.settimeout(60)

    with clients_lock:
        esp32_clients.append(client_socket)

    try:
        while True:
            try:
                data = client_socket.recv(1024)

            except socket.timeout:
                # ESP32가 계속 연결되어 있는지 확인하기 위해
                # 빈 줄을 보내 연결 상태를 검사합니다.
                try:
                    client_socket.sendall(b"\n")
                    continue

                except (ConnectionError, OSError):
                    break

            if not data:
                break

            text = data.decode(
                "utf-8",
                errors="replace"
            ).strip()

            if text:
                print(
                    "ESP32 TCP 메시지:",
                    client_address,
                    text
                )

    except (ConnectionError, OSError):
        pass

    finally:
        with clients_lock:
            if client_socket in esp32_clients:
                esp32_clients.remove(
                    client_socket
                )

        try:
            client_socket.close()
        except OSError:
            pass

        print(
            "ESP32 TCP 연결 종료:",
            client_address
        )


# ==================================================
# TCP 서버 실행
# ==================================================

def run_tcp_server():
    server_socket = socket.socket(
        socket.AF_INET,
        socket.SOCK_STREAM
    )

    server_socket.setsockopt(
        socket.SOL_SOCKET,
        socket.SO_REUSEADDR,
        1
    )

    server_socket.bind(
        ("0.0.0.0", TCP_PORT)
    )

    server_socket.listen(10)

    print(
        f"ESP32 TCP server started: "
        f"0.0.0.0:{TCP_PORT}"
    )

    while True:
        client_socket, client_address = (
            server_socket.accept()
        )

        client_thread = Thread(
            target=handle_esp32_client,
            args=(
                client_socket,
                client_address
            ),
            daemon=True
        )

        client_thread.start()


# ==================================================
# 메인 웹페이지
# ==================================================

@app.route("/", methods=["GET"])
def home():
    with data_lock:
        current_message = latest_message
        current_time = latest_time

        current_command = latest_command
        current_command_time = (
            latest_command_time
        )

        current_history = list(
            reversed(message_history)
        )

    return render_template_string(
        HTML_PAGE,
        latest_message=current_message,
        latest_time=current_time,
        latest_command=current_command,
        latest_command_time=(
            current_command_time
        ),
        message_history=current_history,
        connected_clients=get_client_count()
    )


# ==================================================
# 웹페이지 자동 업데이트용 API
# ==================================================

@app.route("/api/status", methods=["GET"])
def api_status():
    with data_lock:
        current_message = latest_message
        current_time = latest_time

        current_command = latest_command
        current_command_time = (
            latest_command_time
        )

        current_history = list(
            reversed(message_history)
        )

    response = jsonify({
        "latest_message": current_message,
        "latest_time": current_time,
        "latest_command": current_command,
        "latest_command_time": (
            current_command_time
        ),
        "message_history": current_history,
        "connected_clients": (
            get_client_count()
        )
    })

    # 브라우저 캐시 때문에 이전 값이 표시되지 않도록 설정
    response.headers["Cache-Control"] = (
        "no-store, no-cache, must-revalidate, "
        "max-age=0"
    )
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"

    return response


# ==================================================
# ESP32에서 올라오는 데이터 수신
# ==================================================

@app.route("/receive", methods=["POST"])
def receive_data():
    global latest_message
    global latest_time

    received_data = request.get_data(
        as_text=True
    ).strip()

    if received_data == "":
        return "EMPTY_DATA", 400

    receive_time = datetime.now().strftime(
        "%Y-%m-%d %H:%M:%S"
    )

    with data_lock:
        latest_message = received_data
        latest_time = receive_time

        message_history.append({
            "time": receive_time,
            "message": received_data
        })

        if len(message_history) > 20:
            message_history.pop(0)

    print("--------------------------------")
    print("마이크로비트 데이터 수신")
    print("시간:", receive_time)
    print("데이터:", received_data)
    print("ESP32 IP:", request.remote_addr)
    print("--------------------------------")

    return "OK", 200


# ==================================================
# 웹에서 ESP32로 명령 즉시 전송
# ==================================================

@app.route("/send-command", methods=["POST"])
def send_command():
    global latest_command
    global latest_command_time

    command = request.form.get(
        "command",
        ""
    ).strip()

    if command == "":
        return redirect(url_for("home"))

    sent_count, removed_count = (
        broadcast_command(command)
    )

    send_time = datetime.now().strftime(
        "%Y-%m-%d %H:%M:%S"
    )

    with data_lock:
        latest_command = command
        latest_command_time = send_time

    print("--------------------------------")
    print("서버 명령 전송")
    print("시간:", send_time)
    print("명령:", command)
    print("전송된 ESP32:", sent_count)
    print("끊어진 연결 제거:", removed_count)
    print("--------------------------------")

    return redirect(url_for("home"))


# ==================================================
# 실행
# ==================================================

if __name__ == "__main__":
    tcp_thread = Thread(
        target=run_tcp_server,
        daemon=True
    )

    tcp_thread.start()

    app.run(
        host="0.0.0.0",
        port=FLASK_PORT,
        debug=False,
        threaded=True
    )
