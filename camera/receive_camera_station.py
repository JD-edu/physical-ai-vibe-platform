#!/usr/bin/env python3
"""Receive a LilyGO ESP32 station-mode MJPEG stream and display it with OpenCV."""
import argparse
from pathlib import Path
import time
import threading
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, build_opener

MAX_FRAME_BYTES = 5 * 1024 * 1024


def stream_url(value):
    if "://" not in value:
        value = "http://" + value
    parsed = urlsplit(value)
    if (parsed.scheme != "http" or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment):
        raise argparse.ArgumentTypeError("Use http://CAMERA_IP/stream")
    try:
        parsed.port
    except ValueError as error:
        raise argparse.ArgumentTypeError(str(error)) from error
    if parsed.path in ("", "/"):
        value = value.rstrip("/") + "/stream"
    return value


def jpeg_frames(response):
    """Extract complete JPEGs across arbitrary network chunk boundaries."""
    if not response.headers.get('Content-Type', '').lower().startswith('multipart/x-mixed-replace'):
        raise ValueError('Expected an MJPEG stream; check camera IP and stream port')
    buffer = bytearray()
    while True:
        chunk = response.read1(16384)
        if not chunk:
            raise ConnectionError('Camera stream closed')
        buffer.extend(chunk)
        while True:
            start = buffer.find(b'\xff\xd8')
            if start < 0:
                # Preserve a possible split JPEG start marker, discard multipart headers.
                buffer[:] = buffer[-1:]
                break
            if start:
                del buffer[:start]
            end = buffer.find(b'\xff\xd9', 2)
            if end < 0:
                if len(buffer) > MAX_FRAME_BYTES:
                    raise ValueError('Camera frame exceeds size limit')
                break
            end += 2
            if end > MAX_FRAME_BYTES:
                raise ValueError('Camera frame exceeds size limit')
            frame = bytes(buffer[:end])
            del buffer[:end]
            yield frame


class LatestCameraFrames:
    """Drain MJPEG on a worker; retain one latest JPEG instead of a playback queue."""

    def __init__(self, url, timeout=3):
        self.url = url
        self.timeout = timeout
        self.condition = threading.Condition()
        self.stopped = threading.Event()
        self.sequence = 0
        self.latest = None
        self.error = None
        self.thread = threading.Thread(target=self._receive, daemon=True)

    def start(self):
        self.thread.start()
        return self

    def _receive(self):
        try:
            opener = build_opener(ProxyHandler({}))
            with opener.open(self.url, timeout=self.timeout) as response:
                for jpeg in jpeg_frames(response):
                    if self.stopped.is_set():
                        break
                    with self.condition:
                        self.sequence += 1
                        self.latest = jpeg
                        self.condition.notify_all()
        except (OSError, URLError, ValueError) as error:
            with self.condition:
                self.error = error
                self.condition.notify_all()

    def next(self, previous, timeout=0.03):
        with self.condition:
            self.condition.wait_for(
                lambda: self.sequence > previous or self.error is not None or self.stopped.is_set(),
                timeout=timeout,
            )
            if self.sequence > previous:
                return self.sequence, self.latest
            if self.error is not None:
                raise self.error
            return None

    def stop(self):
        self.stopped.set()
        with self.condition:
            self.condition.notify_all()
        # A stalled read is bounded by the socket timeout; do not block the GUI
        # waiting on a buffered reader lock held by the network thread.
        self.thread.join(timeout=0.2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True, type=stream_url, help='Camera LAN IP or stream URL printed by Serial Monitor')
    parser.add_argument('--no-display', action='store_true', help='Receive/decode without a GUI')
    parser.add_argument('--frames', type=int, default=0, help='Exit after this many decoded frames; 0 = continuous')
    parser.add_argument('--save', type=Path, help='Save first decoded frame as JPEG; S key also saves here')
    args = parser.parse_args()
    if args.frames < 0:
        parser.error('--frames must be nonnegative')
    try:
        import cv2
        import numpy as np
    except ImportError:
        parser.exit(1, 'Install dependencies: python3 -m pip install -r camera/requirements.txt\n')
    print(f'ESP32 camera -> PC Python: {args.url} (latest frame only)', flush=True)
    print('Quit: Q / Esc / Ctrl+C. Save frame: S.', flush=True)
    count = 0
    last_report = time.monotonic()
    interval_frames = 0
    saved = False
    current_jpeg = None
    if not args.no_display:
        cv2.namedWindow('ESP32 Wi-Fi Camera', cv2.WINDOW_NORMAL)

    def window_input():
        if args.no_display:
            return False
        key = cv2.waitKey(1) & 0xff
        if key in (ord('q'), 27) or cv2.getWindowProperty('ESP32 Wi-Fi Camera', cv2.WND_PROP_VISIBLE) < 1:
            return True
        if key == ord('s') and current_jpeg:
            output = args.save or Path('camera_frame.jpg')
            output.write_bytes(current_jpeg)
            print(f'Saved: {output}', flush=True)
        return False

    try:
        while True:
            receiver = LatestCameraFrames(args.url).start()
            previous = 0
            try:
                while True:
                    if window_input():
                        return
                    item = receiver.next(previous)
                    if item is None:
                        continue
                    sequence, jpeg = item
                    previous = sequence
                    frame = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)
                    if frame is None:
                        print('Skipping invalid JPEG', flush=True)
                        continue
                    current_jpeg = jpeg
                    count += 1
                    interval_frames += 1
                    now = time.monotonic()
                    if count == 1 or now - last_report >= 2:
                        elapsed = max(now - last_report, 0.001)
                        print(f'RX #{count}: {frame.shape[1]}x{frame.shape[0]}, {len(jpeg)} bytes, {interval_frames / elapsed:.1f} FPS, network frame #{sequence}', flush=True)
                        interval_frames = 0
                        last_report = now
                    if args.save and not saved:
                        args.save.write_bytes(jpeg)
                        saved = True
                        print(f'Saved: {args.save}', flush=True)
                    if not args.no_display:
                        cv2.imshow('ESP32 Wi-Fi Camera', frame)
                    if args.frames and count >= args.frames:
                        return
            except (OSError, URLError, ValueError) as error:
                print(f'Camera disconnected: {error}. Retrying in 0.5 seconds...', flush=True)
            finally:
                receiver.stop()
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        if not args.no_display:
            cv2.destroyAllWindows()
        print(f'Receiver stopped; decoded {count} frames', flush=True)


if __name__ == '__main__':
    main()
