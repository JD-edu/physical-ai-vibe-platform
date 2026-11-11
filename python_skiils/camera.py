"""카메라에서 직접 영상을 받습니다. PC 영상 중계 서버는 없습니다.

네트워크 수신만 별도 스레드에서 합니다. 오래된 프레임을 쌓지 않고 최신 1장만 보관합니다.
"""

import threading
import time
from urllib.request import build_opener, ProxyHandler
from compiler import normalize_camera_url


def jpeg_frames(response, stopped):
    content_type = response.headers.get("Content-Type", "").lower()
    if not content_type.startswith("multipart/x-mixed-replace"):
        raise ValueError("MJPEG 영상이 아닙니다. /stream 주소를 확인하세요.")
    buffer = b""
    while not stopped.is_set():
        chunk = response.read1(16384)
        if not chunk:
            raise ConnectionError("카메라 연결이 종료되었습니다.")
        buffer += chunk
        while True:
            start = buffer.find(b"\xff\xd8")
            if start < 0:
                buffer = buffer[-1:]
                break
            buffer = buffer[start:]
            end = buffer.find(b"\xff\xd9", 2)
            if end < 0:
                if len(buffer) > 5 * 1024 * 1024:
                    raise ValueError("영상 한 장이 너무 큽니다.")
                break
            if end + 2 > 5 * 1024 * 1024:
                raise ValueError("영상 한 장이 너무 큽니다.")
            yield buffer[: end + 2]
            buffer = buffer[end + 2 :]


def receive_network(state):
    retry = 0
    while not state["stopped"].is_set():
        try:
            state["status"] = "카메라 연결 중"
            opener = build_opener(ProxyHandler({}))
            with opener.open(state["url"], timeout=3) as response:
                for jpeg in jpeg_frames(response, state["stopped"]):
                    # 튜플 전체를 한 번에 바꿉니다. '새 프레임 + 수신 시각 + 순번'입니다.
                    state["latest"] = (jpeg, time.monotonic(), state["latest"][2] + 1)
                    state["status"] = "카메라 연결 완료"
                    retry = 0
        except Exception as error:
            if state["stopped"].is_set():
                break
            retry += 1
            state["status"] = str(error) + " / 자동 재연결 중"
            state["stopped"].wait(min(retry, 5))
    state["status"] = "카메라 꺼짐"


def receive_webcam(state):
    import cv2

    capture = cv2.VideoCapture(0)
    try:
        if not capture.isOpened():
            raise ValueError("PC 웹캠을 열 수 없습니다.")
        while not state["stopped"].is_set():
            ok, frame = capture.read()
            if not ok:
                raise ValueError("웹캠 영상을 읽을 수 없습니다.")
            state["latest"] = (frame, time.monotonic(), state["latest"][2] + 1)
            state["status"] = "PC 웹캠 연결 완료"
            state["stopped"].wait(0.03)
    except Exception as error:
        state["status"] = str(error)
    finally:
        capture.release()


def start_camera(source):
    # OpenCV는 영상 기능을 사용할 때만 필요합니다.
    import cv2

    state = {
        "source": source,
        "latest": (None, 0, 0),
        "status": "준비 중",
        "stopped": threading.Event(),
    }
    if source["type"] == "webcam":
        target = receive_webcam
    else:
        state["url"] = normalize_camera_url(source.get("url", ""))
        if not state["url"]:
            raise ValueError("카메라 스트림 주소를 입력하세요.")
        target = receive_network
    state["thread"] = threading.Thread(target=target, args=(state,), daemon=True)
    state["thread"].start()
    return state


def latest_frame(state):
    import cv2
    import numpy as np

    data, received, sequence = state["latest"]
    if data is None or state["stopped"].is_set() or time.monotonic() - received > 5:
        return None, sequence
    if state["source"]["type"] == "webcam":
        return data.copy(), sequence
    frame = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    return frame, sequence


def stop_camera(state):
    if state is not None:
        state["stopped"].set()
        state["thread"].join(timeout=0.2)
