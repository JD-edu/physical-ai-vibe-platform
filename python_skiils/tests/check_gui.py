"""실제 Tkinter + 가짜 카메라/브릿지 검사. 실제 하드웨어에는 전송하지 않습니다."""

import json
import os
import subprocess
from pathlib import Path
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from files import FOLDER, read_json
from compiler import compile_intent, make_context
from runtime import set_slider
import ui

commands = []
frame = np.full((240, 320, 3), (20, 80, 210), dtype=np.uint8)
ok, jpeg = cv2.imencode(".jpg", frame)
assert ok
jpeg = jpeg.tobytes()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *arguments):
        pass

    def do_GET(self):
        self.send_response(200)
        if self.path == "/stream":
            self.send_header(
                "Content-Type", "multipart/x-mixed-replace; boundary=frame"
            )
            self.end_headers()
            try:
                while True:
                    packet = (
                        b"\r\n--frame\r\nContent-Type: image/jpeg\r\n\r\n"
                        + jpeg
                        + b"\r\n"
                    )
                    self.wfile.write(packet[:-1])
                    self.wfile.flush()
                    self.wfile.write(packet[-1:])
                    self.wfile.flush()
                    time.sleep(0.05)
            except (BrokenPipeError, ConnectionResetError):
                pass
        else:
            self.end_headers()
            result = {
                "connected_clients": 1,
                "message_sequence": 0,
                "message_history": [],
            }
            self.wfile.write(json.dumps(result).encode())

    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        commands.append(data["command"])
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"sent_count":1}')


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
url = "http://127.0.0.1:" + str(server.server_port)
state = None
try:
    project = compile_intent(
        read_json(FOLDER / "examples/02_camera_remote.json"),
        make_context("", url + "/stream"),
    )
    state = ui.build_app(project, url, dry_run=False)
    state["root"].withdraw()
    view = state["cameras"][0]
    ui.camera_start(state, view)
    ui.connect_bridge(state)

    def wait_until(condition):
        deadline = time.monotonic() + 90
        while not condition():
            state["root"].update()
            if time.monotonic() > deadline:
                raise AssertionError("GUI timeout")
            time.sleep(0.02)

    wait_until(lambda: view["image"].image is not None)
    wait_until(lambda: "연결 완료" in state["network_status"].get())
    assert view["camera"]["latest"][2] > 0
    for speed in [0, 27, 80]:
        set_slider(project, "feature-2", speed)
        for widget in project["widgets"]:
            if widget["type"] != "button":
                continue
            previous = len(commands)
            direction = widget["actions"][0]["direction"]
            ui.send_button(state, widget["id"])
            wait_until(lambda: len(commands) > previous)
            assert commands[-1] == "CMD:motor:" + direction + ":" + str(
                0 if direction == "stop" else speed
            )
    ui.camera_stop(state, view)
    ui.disconnect_bridge(state)
    print(
        "PASS: actual Tkinter direct MJPEG display, bridge connection, current speed 0/27/80, four directions, stop=0, cleanup."
    )
    if "--cnn" in sys.argv:
        os.environ["KERAS_HOME"] = "/tmp/phyvibe-python-keras-cache"
        os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"
        ui.close_app(state)
        state = None
        with tempfile.TemporaryDirectory() as folder:
            project = compile_intent(
                read_json(FOLDER / "examples/03_classifier.json"),
                make_context("", url + "/stream"),
            )
            state = ui.build_app(project, url, models_folder=Path(folder) / "models")
            state["root"].withdraw()
            view = state["cameras"][0]
            ui.camera_start(state, view)
            wait_until(lambda: view["image"].image is not None)
            for label, color in [("양품", (10, 20, 220)), ("불량", (220, 20, 10))]:
                ok, new_jpeg = cv2.imencode(
                    ".jpg", np.full((240, 320, 3), color, dtype=np.uint8)
                )
                assert ok
                jpeg = new_jpeg.tobytes()
                for step in range(20):
                    state["root"].update()
                    time.sleep(0.02)
                ui.collect_samples(state, view, label)
                wait_until(lambda: not view["busy"])
                assert len(view["cnn"]["samples"][label]) == 5, view["status"].get()
            ui.train_clicked(state, view)
            wait_until(lambda: not view["busy"])
            assert view["cnn"]["head"] is not None, view["status"].get()
            ui.predict_clicked(state, view)
            wait_until(lambda: not view["busy"])
            assert "%" in view["status"].get(), view["status"].get()
            ui.reset_clicked(state, view)
            ui.load_clicked(state, view)
            wait_until(lambda: not view["busy"])
            assert view["cnn"]["head"] is not None, view["status"].get()
            from exporting import export_app

            destination = export_app(
                project, Path(folder) / "exported", state["models"]
            )
            child = "from files import read_json; import cnn,numpy as np; p=read_json('project.json'); c=cnn.new_classifier(p['widgets'][0]['action']['classes']); cnn.load_classifier(c,'models/feature-1'); print(cnn.predict(c,np.full((240,320,3),(220,20,10),dtype=np.uint8)))"
            subprocess.run([sys.executable, "-c", child], cwd=destination, check=True)
            ui.camera_stop(state, view)
            print(
                "PASS: actual CNN GUI sample collection, training, inference, save/load, exported folder inference in a separate Python process without LLM/editor."
            )

finally:
    if state is not None:
        ui.close_app(state)
    server.shutdown()
    server.server_close()
    thread.join()
