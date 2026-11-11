"""표준 라이브러리만 쓰는 처리 흐름 검사. 실제 장치에는 전송하지 않습니다."""

import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

FOLDER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(FOLDER))
from files import read_json
from compiler import compile_intent, make_context
from runtime import press_button, set_slider, apply_sensor_line
from skills import classify_decision
from llm import generate, extract_intent
from exporting import export_app


def example(filename):
    return read_json(FOLDER / "examples" / filename)


class MockServer(BaseHTTPRequestHandler):
    replies = []
    commands = []
    requests = []

    def log_message(self, *arguments):
        pass

    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        if self.path == "/v1/models":
            data = {"data": [{"id": "test-model"}]}
        else:
            data = {
                "connected_clients": 1,
                "message_sequence": 0,
                "message_history": [],
            }
        self.wfile.write(json.dumps(data).encode())

    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.requests.append(data)
        if self.path == "/api/command":
            self.commands.append(data["command"])
            if data["command"] == "fail":
                self.send_response(500)
                result = {"error": "test failure"}
            else:
                self.send_response(200)
                result = {"sent_count": 1}
        else:
            self.send_response(200)
            result = {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                self.replies.pop(0), ensure_ascii=False
                            )
                        }
                    }
                ]
            }
        self.end_headers()
        self.wfile.write(json.dumps(result).encode())


class FlowTests(unittest.TestCase):
    def setUp(self):
        self.context = make_context("", "http://camera/stream")
        MockServer.requests = []
        MockServer.commands = []
        MockServer.replies = []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), MockServer)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = "http://127.0.0.1:" + str(self.server.server_port)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_remote_and_send(self):
        project = compile_intent(example("02_camera_remote.json"), self.context)
        self.assertEqual(len(project["widgets"]), 7)
        for speed in [0, 27, 80]:
            set_slider(project, "feature-2", speed)
            for widget in project["widgets"]:
                if widget["type"] == "button":
                    preview = press_button(project, widget["id"], self.url)
                    direction = widget["actions"][0]["direction"]
                    expected_speed = 0 if direction == "stop" else speed
                    self.assertEqual(
                        preview[0]["command"],
                        "CMD:motor:" + direction + ":" + str(expected_speed),
                    )
        self.assertEqual(MockServer.commands, [])
        press_button(project, "feature-3", self.url, dry_run=False)
        self.assertEqual(MockServer.commands, ["CMD:motor:forward:80"])

    def test_llm_retry_and_unsupported(self):
        intent = example("01_camera.json")
        MockServer.replies = [{"widgets": []}, intent]
        trace = []
        result, project = generate("카메라 영상", self.context, self.url, trace=trace)
        self.assertEqual(result, intent)
        self.assertEqual(len(project["widgets"]), 1)
        self.assertEqual(len(trace), 2)
        self.assertIn("validation_error", trace[0])
        self.assertIn(
            "Intent validation failed",
            MockServer.requests[-1]["messages"][-1]["content"],
        )
        MockServer.replies = [example("07_unsupported.json")]
        with self.assertRaisesRegex(ValueError, "지원하지 않는"):
            generate("OCR", self.context, self.url)
        self.assertEqual(len(MockServer.replies), 0)

    def test_profiles_schema_and_urls(self):
        original = example("02_camera_remote.json")
        for value in [81, -1, True, "50"]:
            bad = copy.deepcopy(original)
            bad["features"][1]["speed"] = value
            with self.assertRaises(ValueError):
                compile_intent(bad, self.context)
        bad = copy.deepcopy(original)
        bad["features"][1]["speedFrom"] = "invented"
        with self.assertRaises(ValueError):
            compile_intent(bad, self.context)
        with self.assertRaises(ValueError):
            compile_intent(original, self.context, {"skills": ["send_text"]})
        bad = example("01_camera.json")
        bad["features"][0]["url"] = "http://invented/stream"
        with self.assertRaises(ValueError):
            compile_intent(bad, self.context)
        context = make_context("영상 http://requested/stream", "http://camera/stream")
        bad["features"][0]["url"] = "http://requested/stream"
        self.assertEqual(
            compile_intent(bad, context)["widgets"][0]["action"]["source"]["url"],
            "http://requested/stream",
        )

    def test_classifier_game_sensors_and_export(self):
        project = compile_intent(example("04_classifier_motor.json"), self.context)
        config = project["widgets"][0]["action"]
        self.assertEqual(
            classify_decision(config, "물체 있음", 0.99)["text"], "CMD:motor:forward:30"
        )
        self.assertEqual(
            classify_decision(config, "물체 없음", 0.99)["text"], "CMD:motor:stop:0"
        )
        self.assertEqual(
            classify_decision(config, "물체 있음", float("nan"))["text"], ""
        )
        config = compile_intent(example("05_game.json"), self.context)["widgets"][0][
            "action"
        ]
        self.assertEqual(
            classify_decision(config, "rock", 0.99, "scissors")["text"], "O"
        )
        project = compile_intent(example("06_servo_sensor_text.json"), self.context)
        apply_sensor_line(project, "DATA:temperature:24.5")
        self.assertEqual(project["widgets"][1]["value"], 24.5)
        self.assertEqual(project["widgets"][1]["points"][-1], 24.5)
        with tempfile.TemporaryDirectory() as folder:
            exported = export_app(project, Path(folder) / "app")
            self.assertTrue((exported / "run_app.py").exists())
            self.assertFalse((exported / "llm.py").exists())
            subprocess.run(
                [
                    sys.executable,
                    "-c",
                    "import ui; from files import read_json; print(read_json('project.json')['title'])",
                ],
                cwd=exported,
                check=True,
                capture_output=True,
            )
        self.assertEqual(
            extract_intent('<think>test</think>```json\n{"version":1}\n```'),
            {"version": 1},
        )

    def test_macro_failure_stops_sequence(self):
        intent = {
            "version": 1,
            "title": "순서",
            "features": [
                {
                    "kind": "macro",
                    "effects": [
                        {"kind": "transmit_text", "text": "fail"},
                        {"kind": "transmit_text", "text": "must-not-send"},
                    ],
                }
            ],
        }
        project = compile_intent(intent)
        with self.assertRaises(ValueError):
            press_button(project, "feature-1", self.url, dry_run=False)
        self.assertEqual(MockServer.commands, ["fail"])


if __name__ == "__main__":
    unittest.main()
