"""Python Tkinter 화면. 핵심 흐름은 main.py → llm.py → compiler.py입니다.

화면 관련 코드는 길어서 이 파일에 모았습니다. 기본 함수와 딕셔너리를 사용합니다.
partial은 '버튼에 함수와 전달할 값을 연결'하는 표준 도구입니다.
느린 HTTP/CNN 작업은 스레드에서 실행하고 Tkinter 수정은 메인 스레드에서만 합니다.
"""

import json
import copy
import gc
import queue
import secrets
import threading
import time
from functools import partial
from pathlib import Path
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from files import write_json
from compiler import normalize_camera_url
from skills import classify_decision
from runtime import set_slider, press_button, apply_sensor_line
from http_tools import bridge_status, send_command
from camera import start_camera, latest_frame, stop_camera
from exporting import export_app


def log(state, message):
    state["log"].insert("end", message + "\n")
    state["log"].see("end")


def start_job(state, function, arguments, done):
    # 화면 콜백은 메인 스레드에 보관합니다. 작업에는 데이터와 큐만 전달합니다.
    job_id = state["next_job"]
    state["next_job"] += 1
    state["callbacks"][job_id] = done
    events = state["events"]

    def work():
        try:
            result = function(*arguments)
            events.put(("result", job_id, result, None))
        except Exception as error:
            events.put(("result", job_id, None, str(error)))

    threading.Thread(target=work, daemon=True).start()


def finish_job(state, result, error):
    if error:
        log(state, "오류: " + error)
    else:
        log(state, json.dumps(result, ensure_ascii=False, default=str))


def send_button(state, widget_id):
    if not state["dry_run"] and not state["connected"]:
        log(state, "먼저 브릿지 서버를 연결하세요.")
        return
    start_job(
        state,
        press_button,
        (
            copy.deepcopy(state["project"]),
            widget_id,
            state["bridge_url"].get(),
            state["dry_run"],
        ),
        partial(finish_job, state),
    )


def slider_changed(state, widget, text):
    set_slider(state["project"], widget["id"], float(text))


def poll_bridge(state):
    if not state["connected"] or state["polling"]:
        return
    state["polling"] = True
    token = state["connection_number"]

    def done(result, error):
        state["polling"] = False
        if token != state["connection_number"]:
            return
        if error:
            state["network_status"].set("연결 실패 · 자동 재시도: " + error)
            return
        state["network_status"].set(
            "서버 연결 완료 · ESP32 " + str(result.get("connected_clients", 0)) + "대"
        )
        if result.get("message_sequence", 0) < state["last_id"]:
            state["last_id"] = 0
        history = result.get("message_history", [])
        history = sorted(history, key=message_id)
        for item in history:
            if item["id"] <= state["last_id"]:
                continue
            for line in str(item["message"]).splitlines():
                log(state, "RX " + line)
                apply_sensor_line(state["project"], line)
            state["last_id"] = item["id"]
        refresh_sensors(state)

    start_job(state, bridge_status, (state["bridge_url"].get(),), done)


def message_id(message):
    return message["id"]


def connect_bridge(state):
    state["connection_number"] += 1
    state["connected"] = True
    state["last_id"] = 0
    poll_bridge(state)


def disconnect_bridge(state):
    state["connection_number"] += 1
    state["connected"] = False
    state["network_status"].set("연결 중지")


def refresh_sensors(state):
    for widget in state["project"]["widgets"]:
        if widget["id"] not in state["sensors"]:
            continue
        view = state["sensors"][widget["id"]]
        value = widget["value"]
        view["text"].set(str(value) + " " + widget["unit"])
        if "gauge" in view and type(value) in [int, float]:
            span = max(1, widget["max"] - widget["min"])
            view["gauge"]["value"] = 100 * (value - widget["min"]) / span
        if "chart" in view:
            canvas = view["chart"]
            canvas.delete("all")
            points = widget.get("points", [])
            if len(points) > 1:
                low = min(points)
                high = max(points)
                coordinates = []
                for index, point in enumerate(points):
                    coordinates += [
                        10 + index * 280 / (len(points) - 1),
                        90 - (point - low) * 80 / max(1, high - low),
                    ]
                canvas.create_line(coordinates, fill="#2471a3", width=2)
        if widget["type"] == "alert" and type(value) in [int, float]:
            color = "#b45309" if value <= widget["threshold"] else "#166534"
            view["label"].configure(foreground=color)


def camera_start(state, view):
    if view["camera"] is not None or view["busy"]:
        return
    try:
        source = {"type": view["input"].get()}
        if source["type"] == "esp32_stream":
            source["url"] = normalize_camera_url(view["url"].get())
        # 같은 앱에서 같은 카메라를 두 번 열지 않습니다.
        for other in state["cameras"]:
            if other is not view and other["camera"] is not None:
                if other["widget"]["action"]["source"] == source:
                    camera_stop(state, other)
        view["camera"] = start_camera(source)
        view["widget"]["action"]["source"] = source
        view["source_box"].configure(state="disabled")
        view["url_box"].configure(state="disabled")
    except Exception as error:
        log(state, "카메라 오류: " + str(error))


def camera_stop(state, view):
    view["live"] = False
    stop_camera(view["camera"])
    view["camera"] = None
    view["status"].set("카메라 꺼짐")
    view["source_box"].configure(state="readonly")
    view["url_box"].configure(state="normal")
    view["image"].configure(image="", text="카메라 꺼짐")
    view["image"].image = None


def camera_frame(camera):
    if camera is None:
        raise ValueError("먼저 카메라를 시작하세요.")
    frame, sequence = latest_frame(camera)
    if frame is None:
        raise ValueError("최신 카메라 영상이 없습니다.")
    return frame, sequence


def sample_work(classifier, camera, label):
    import cnn

    cnn.prepare_model(classifier)
    previous = -1
    count = 0
    deadline = time.monotonic() + 15
    while count < 5:
        if camera is None or camera["stopped"].is_set() or time.monotonic() > deadline:
            raise ValueError("샘플 수집 중 영상이 끊겼습니다.")
        frame, sequence = camera_frame(camera)
        if sequence != previous:
            cnn.add_sample(classifier, label, frame)
            previous = sequence
            count += 1
        time.sleep(0.18)
    return label + " 샘플 5장 수집 완료"


def cnn_done(state, view, result, error):
    view["busy"] = False
    if error:
        view["status"].set("오류: " + error)
        log(state, "CNN 오류: " + error)
        view["live"] = False
    elif isinstance(result, dict):
        view["status"].set(result["message"])
        if result["game"] and result["outcome"] in view["scores"]:
            view["scores"][result["outcome"]] += 1
            scores = view["scores"]
            view["score_text"].set(
                "사용자 "
                + str(scores["win"])
                + " : PC "
                + str(scores["loss"])
                + " · 무승부 "
                + str(scores["draw"])
            )
    elif result is not None:
        view["status"].set(str(result))
    if view["live"]:
        view["next_prediction"] = time.monotonic() + 0.5
    for label in view["counts"]:
        count = len(view["cnn"]["samples"][label])
        view["counts"][label].set(label + ": " + str(count) + "장")


def collect_samples(state, view, label):
    if view["busy"]:
        return
    view["live"] = False
    view["busy"] = True
    start_job(
        state,
        sample_work,
        (view["cnn"], view["camera"], label),
        partial(cnn_done, state, view),
    )


def train_work(classifier, folder, events, widget_id):
    import cnn

    def progress(message):
        events.put(("progress", widget_id, message, None))

    cnn.train(classifier, progress)
    cnn.save_classifier(classifier, folder)
    return "학습 완료 · 모델 저장 완료"


def train_clicked(state, view):
    if view["busy"]:
        return
    view["live"] = False
    view["busy"] = True
    start_job(
        state,
        train_work,
        (
            view["cnn"],
            state["models"] / view["widget"]["id"],
            state["events"],
            view["widget"]["id"],
        ),
        partial(cnn_done, state, view),
    )


def load_work(classifier, folder):
    import cnn

    cnn.load_classifier(classifier, folder)
    return "저장된 모델 준비 완료 · 재학습 없이 분류할 수 있습니다."


def load_clicked(state, view):
    if view["busy"]:
        return
    view["busy"] = True
    start_job(
        state,
        load_work,
        (view["cnn"], state["models"] / view["widget"]["id"]),
        partial(cnn_done, state, view),
    )


def predict_work(config, classifier, camera, bridge_url, dry_run, connected):
    import cnn

    opponent = None
    if "game" in config:
        opponent = secrets.choice(config["classes"])
    frame, sequence = camera_frame(camera)
    label, confidence = cnn.predict(classifier, frame)
    decision = classify_decision(config, label, confidence, opponent)
    message = label + " " + str(round(confidence * 100)) + "% · " + decision["outcome"]
    if opponent:
        message += " · PC: " + opponent
    if decision["text"]:
        if not dry_run and (not connected or camera["stopped"].is_set()):
            message += " · 전송 안 됨: 브릿지를 연결하세요."
        else:
            response = send_command(decision["text"], bridge_url, dry_run)
            message += (
                " · 명령: "
                + decision["text"]
                + " · "
                + json.dumps(response, ensure_ascii=False)
            )
    return {
        "message": message,
        "outcome": decision["outcome"],
        "game": "game" in config,
    }


def predict_clicked(state, view):
    if view["busy"]:
        return
    view["busy"] = True
    start_job(
        state,
        predict_work,
        (
            copy.deepcopy(view["widget"]["action"]),
            view["cnn"],
            view["camera"],
            state["bridge_url"].get(),
            state["dry_run"],
            state["connected"],
        ),
        partial(cnn_done, state, view),
    )


def toggle_live(state, view):
    view["live"] = not view["live"]
    view["next_prediction"] = time.monotonic()


def reset_clicked(state, view):
    if view["busy"]:
        return
    import cnn

    view["live"] = False
    view["scores"] = {"win": 0, "loss": 0, "draw": 0}
    view["score_text"].set("")
    view["cnn"] = cnn.new_classifier(view["widget"]["action"]["classes"])
    cnn_done(
        state,
        view,
        "학습 상태 초기화 · 디스크의 마지막 저장본은 모델 불러오기로 복원 가능합니다.",
        None,
    )


def export_clicked(state):
    # 학습 중 파일이 바뀌는 상태에서는 내보내지 않습니다.
    for view in state["cameras"]:
        if view["busy"]:
            log(state, "CNN 작업이 끝난 뒤 내보내세요.")
            return
    destination = filedialog.askdirectory(title="비어 있는 새 폴더를 선택하세요")
    if destination:
        try:
            state["project"]["network"] = {
                "bridgeUrl": state["bridge_url"].get(),
                "deviceProfile": "esp32",
            }
            export_app(state["project"], destination, state["models"])
            log(state, "앱 내보내기 완료: " + destination)
        except Exception as error:
            log(state, "내보내기 오류: " + str(error))


def make_camera_view(state, parent, widget):
    config = widget["action"]
    view = {
        "widget": widget,
        "camera": None,
        "busy": False,
        "live": False,
        "next_prediction": 0,
        "counts": {},
        "scores": {"win": 0, "loss": 0, "draw": 0},
        "score_text": tk.StringVar(value=""),
        "status": tk.StringVar(value="카메라 연결 대기"),
        "input": tk.StringVar(value=config["source"]["type"]),
        "url": tk.StringVar(value=config["source"].get("url", "")),
    }
    source_box = ttk.Combobox(
        parent,
        textvariable=view["input"],
        values=["esp32_stream", "webcam"],
        state="readonly",
    )
    source_box.pack(fill="x")
    view["source_box"] = source_box
    view["url_box"] = ttk.Entry(parent, textvariable=view["url"])
    view["url_box"].pack(fill="x")
    view["image"] = ttk.Label(parent, text="카메라 영상", anchor="center")
    view["image"].image = None
    view["image"].pack(fill="both", expand=True)
    buttons = ttk.Frame(parent)
    buttons.pack()
    ttk.Button(
        buttons, text="스트리밍 시작", command=partial(camera_start, state, view)
    ).pack(side="left")
    ttk.Button(
        buttons, text="스트리밍 종료", command=partial(camera_stop, state, view)
    ).pack(side="left")
    ttk.Label(parent, textvariable=view["status"], wraplength=420).pack()
    if widget["type"] == "classifier":
        ttk.Label(parent, textvariable=view["score_text"]).pack()
        import cnn

        view["cnn"] = cnn.new_classifier(config["classes"])
        for label in config["classes"]:
            row = ttk.Frame(parent)
            row.pack(fill="x")
            view["counts"][label] = tk.StringVar(value=label + ": 0장")
            ttk.Label(row, textvariable=view["counts"][label]).pack(side="left")
            ttk.Button(
                row,
                text="5장 수집",
                command=partial(collect_samples, state, view, label),
            ).pack(side="right")
        for text, function in [
            ("학습", train_clicked),
            ("한 번 분류", predict_clicked),
            ("연속 분류 시작/종료", toggle_live),
            ("모델 불러오기", load_clicked),
            ("초기화", reset_clicked),
        ]:
            ttk.Button(parent, text=text, command=partial(function, state, view)).pack(
                fill="x"
            )
        folder = state["models"] / widget["id"]
        if (folder / "metadata.json").exists():
            load_clicked(state, view)
    state["cameras"].append(view)


def tick(state):
    if state["closed"]:
        return
    while not state["events"].empty():
        kind, job_id, result, error = state["events"].get()
        if kind == "progress":
            for view in state["cameras"]:
                if view["widget"]["id"] == job_id:
                    view["status"].set(result)
        else:
            callback = state["callbacks"].pop(job_id, None)
            if callback is not None:
                callback(result, error)
    for view in state["cameras"]:
        if view["camera"] is not None:
            try:
                import cv2
                from PIL import Image, ImageTk

                frame, sequence = latest_frame(view["camera"])
                if frame is not None:
                    image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                    image.thumbnail((420, 260))
                    photo = ImageTk.PhotoImage(image)
                    view["image"].configure(image=photo, text="")
                    view["image"].image = (
                        photo  # 이 참조를 유지해야 화면의 그림이 사라지지 않습니다.
                    )
                if view["widget"]["type"] == "camera_stream":
                    view["status"].set(view["camera"]["status"])
            except Exception as error:
                view["status"].set(str(error))
        if (
            view["live"]
            and not view["busy"]
            and time.monotonic() >= view["next_prediction"]
        ):
            view["next_prediction"] = time.monotonic() + 0.5
            predict_clicked(state, view)
    if time.monotonic() >= state["next_poll"]:
        state["next_poll"] = time.monotonic() + 1
        poll_bridge(state)
    state["tick_id"] = state["root"].after(50, partial(tick, state))


def close_app(state):
    if state.get("closed"):
        return
    state["closed"] = True
    root = state["root"]
    if state.get("tick_id") is not None:
        root.after_cancel(state["tick_id"])
    for view in state["cameras"]:
        stop_camera(view["camera"])
    state["callbacks"].clear()
    root.destroy()
    # Tkinter 객체의 마지막 정리도 메인 스레드에서 합니다.
    for view in state["cameras"]:
        view.clear()
    state["cameras"].clear()
    state["sensors"].clear()
    for key in ["bridge_url", "network_status", "log", "root"]:
        state.pop(key, None)
    gc.collect()


def scroll_frame(parent):
    # 창보다 내용이 길면 스크롤합니다. 조종 버튼과 영상은 나란히 표시됩니다.
    canvas = tk.Canvas(parent, highlightthickness=0)
    scrollbar = ttk.Scrollbar(parent, orient="vertical", command=canvas.yview)
    scrollbar.pack(side="right", fill="y")
    canvas.pack(side="left", fill="both", expand=True)
    canvas.configure(yscrollcommand=scrollbar.set)
    frame = ttk.Frame(canvas, padding=8)
    window = canvas.create_window((0, 0), window=frame, anchor="nw")

    def content_resized(event):
        canvas.configure(scrollregion=canvas.bbox("all"))

    def canvas_resized(event):
        canvas.itemconfigure(window, width=event.width)

    frame.bind("<Configure>", content_resized)
    canvas.bind("<Configure>", canvas_resized)
    return frame


def build_app(
    project, bridge_url="http://localhost:5000", dry_run=True, models_folder="models"
):
    root = tk.Tk()
    root.title(project["title"] + " · Python PhyVibe")
    root.geometry("1100x850")
    state = {
        "root": root,
        "project": project,
        "dry_run": dry_run,
        "models": Path(models_folder),
        "events": queue.Queue(),
        "callbacks": {},
        "next_job": 1,
        "cameras": [],
        "sensors": {},
        "closed": False,
        "connected": False,
        "polling": False,
        "last_id": 0,
        "connection_number": 0,
        "next_poll": 0,
        "bridge_url": tk.StringVar(value=bridge_url),
        "network_status": tk.StringVar(value="연결 대기"),
    }
    header = ttk.Frame(root, padding=8)
    header.pack(fill="x")
    text = "전송 미리보기 모드" if dry_run else "실제 장치 전송 모드"
    ttk.Label(header, text=text).pack(side="left")
    ttk.Entry(header, textvariable=state["bridge_url"], width=32).pack(side="left")
    ttk.Button(header, text="브릿지 연결", command=partial(connect_bridge, state)).pack(
        side="left"
    )
    ttk.Button(
        header, text="연결 종료", command=partial(disconnect_bridge, state)
    ).pack(side="left")
    ttk.Button(header, text="앱 내보내기", command=partial(export_clicked, state)).pack(
        side="right"
    )
    ttk.Label(root, textvariable=state["network_status"]).pack()
    content = ttk.Panedwindow(root, orient="horizontal")
    content.pack(fill="both", expand=True)
    controls_host = ttk.Frame(content)
    content.add(controls_host, weight=1)
    controls = scroll_frame(controls_host)
    notebook = ttk.Notebook(content)
    content.add(notebook, weight=2)
    remote = ttk.LabelFrame(controls, text="방향 조종", padding=8)
    remote.pack(fill="x")
    positions = {
        "forward": (0, 1),
        "left": (1, 0),
        "stop": (1, 1),
        "right": (1, 2),
        "backward": (2, 1),
    }
    direction_count = {}
    for widget in project["widgets"]:
        kind = widget["type"]
        if kind in ["camera_stream", "classifier"]:
            tab = ttk.Frame(notebook, padding=10)
            notebook.add(tab, text=widget["title"])
            camera_panel = scroll_frame(tab)
            make_camera_view(state, camera_panel, widget)
            if len(state["cameras"]) == 1:
                notebook.select(tab)
            continue
        if kind == "button" and len(widget["actions"]) == 1:
            direction = widget["actions"][0].get("direction")
            if direction in positions:
                row, column = positions[direction]
                group = direction_count.get(direction, 0)
                direction_count[direction] = group + 1
                ttk.Button(
                    remote,
                    text=widget["title"],
                    command=partial(send_button, state, widget["id"]),
                ).grid(row=row + group * 3, column=column, padx=6, pady=6)
                continue
        frame = ttk.LabelFrame(controls, text=widget["title"], padding=6)
        frame.pack(fill="x", pady=3)
        if kind == "control":
            scale = tk.Scale(
                frame,
                from_=widget["min"],
                to=widget["max"],
                orient="horizontal",
                command=partial(slider_changed, state, widget),
            )
            scale.set(widget["value"])
            scale.pack(fill="x", side="left", expand=True)
            ttk.Button(
                frame, text="적용", command=partial(send_button, state, widget["id"])
            ).pack(side="right")
        elif kind == "button":
            ttk.Button(
                frame,
                text=widget["title"],
                command=partial(send_button, state, widget["id"]),
            ).pack()
        else:
            view = {"text": tk.StringVar()}
            view["label"] = ttk.Label(frame, textvariable=view["text"])
            view["label"].pack()
            if kind == "gauge":
                view["gauge"] = ttk.Progressbar(frame, maximum=100)
                view["gauge"].pack(fill="x")
            if kind == "chart":
                view["chart"] = tk.Canvas(frame, height=100, width=310)
                view["chart"].pack()
            state["sensors"][widget["id"]] = view
    if not state["cameras"]:
        content.forget(notebook)
    state["log"] = tk.Text(root, height=8)
    state["log"].pack(fill="x")
    refresh_sensors(state)
    root.protocol("WM_DELETE_WINDOW", partial(close_app, state))
    state["tick_id"] = root.after(50, partial(tick, state))
    return state


def run_app(
    project, bridge_url="http://localhost:5000", dry_run=True, models_folder="models"
):
    state = build_app(project, bridge_url, dry_run, models_folder)
    state["root"].mainloop()
