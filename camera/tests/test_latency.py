"""Direct receiver latency tests with a local fake camera; no real device setup."""
import io
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from email.message import Message
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from receive_camera_station import LatestCameraFrames, jpeg_frames

FRAMES = []
for index in range(20):
    ok, frame = cv2.imencode('.jpg', np.full((240, 320, 3), index, dtype=np.uint8))
    assert ok
    FRAMES.append(frame.tobytes())


class Camera(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
        self.end_headers()
        try:
            for frame in FRAMES:
                self.wfile.write(b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
                self.wfile.flush()
                time.sleep(0.01)
        except (BrokenPipeError, ConnectionResetError):
            pass


class LatencyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Camera)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}/stream'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def test_slow_display_gets_latest(self):
        receiver = LatestCameraFrames(self.url).start()
        try:
            first = receiver.next(0, timeout=2)
            self.assertIsNotNone(first)
            time.sleep(0.35)  # A slow GUI/CNN; the network worker must keep draining.
            sequence, jpeg = receiver.next(first[0], timeout=2)
            self.assertEqual(sequence, 20)
            self.assertEqual(jpeg, FRAMES[-1])
            image = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)
            self.assertEqual(image.shape, (240, 320, 3))
        finally:
            receiver.stop()

    def test_cli_receives_and_saves(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'frame.jpg'
            result = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / 'receive_camera_station.py'),
                                     '--url', self.url, '--no-display', '--frames', '3', '--save', str(output)],
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('decoded 3 frames', result.stdout)
            self.assertEqual(cv2.imread(str(output)).shape, (240, 320, 3))

    def test_fragmented_jpeg_parser(self):
        class Fragmented:
            headers = Message()
            headers['Content-Type'] = 'multipart/x-mixed-replace; boundary=frame'
            data = io.BytesIO(b'--frame\r\n\r\n' + FRAMES[0] + b'\r\n--frame\r\n\r\n' + FRAMES[1])

            def read1(self, _size):
                return self.data.read(1)
        frames = jpeg_frames(Fragmented())
        self.assertEqual(next(frames), FRAMES[0])
        self.assertEqual(next(frames), FRAMES[1])


if __name__ == '__main__':
    unittest.main()
