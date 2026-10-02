from threading import Lock
from pathlib import Path

from flask import Flask, jsonify, render_template, request

template_directory = Path(__file__).resolve().parent / "templates"
app = Flask(__name__, template_folder=str(template_directory))
state_lock = Lock()
state = {
    "microbit_to_server": "-",
    "server_to_microbit": "-",
    "exchange_count": 0,
}


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/status")
def status():
    with state_lock:
        return jsonify(
            microbit_to_server=state["microbit_to_server"],
            server_to_microbit=state["server_to_microbit"],
            exchange_count=state["exchange_count"],
        )


@app.post("/exchange")
def exchange():
    microbit_data = request.get_data(as_text=True).strip()

    with state_lock:
        server_data = microbit_data
        state["microbit_to_server"] = microbit_data
        state["server_to_microbit"] = server_data
        state["exchange_count"] += 1

    print(f"micro:bit -> server: {microbit_data}", flush=True)
    print(f"server -> micro:bit: {server_data}", flush=True)
    return server_data, 200, {"Content-Type": "text/plain; charset=utf-8"}


if __name__ == "__main__":
    print("MODE: BIDIRECTIONAL + OLED + WEB (/exchange)", flush=True)
    print("WEB: http://0.0.0.0:5000/", flush=True)
    app.run(host="0.0.0.0", port=5000)
