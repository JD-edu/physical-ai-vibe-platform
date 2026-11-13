"""버튼·슬라이더·센서의 실행 과정. 화면이 없어도 테스트할 수 있습니다."""

import json
import math
from skills import resolve_action
from http_tools import send_command


def set_slider(project, widget_id, value):
    if type(value) not in [int, float] or not math.isfinite(value):
        raise ValueError("슬라이더 값은 숫자여야 합니다.")
    for widget in project["widgets"]:
        if widget["id"] == widget_id and widget["type"] == "control":
            value = int(math.floor(value + 0.5))
            widget["value"] = max(widget["min"], min(widget["max"], value))
            return widget["value"]
    raise ValueError("슬라이더가 없습니다: " + widget_id)


def press_button(project, widget_id, bridge_url, dry_run=True):
    for widget in project["widgets"]:
        if widget["id"] != widget_id:
            continue
        commands = []
        if widget["type"] == "control":
            commands.append(widget["command"] + ":" + str(widget["value"]))
        elif widget["type"] == "button":
            for action in widget["actions"]:
                commands.append(resolve_action(action, project["widgets"]))
        else:
            raise ValueError("버튼 또는 슬라이더 적용 위젯이 아닙니다.")
        responses = []
        for command in commands:
            # 실패하면 예외가 발생하므로 뒤의 명령은 보내지 않습니다.
            response = send_command(command, bridge_url, dry_run)
            response["command"] = command
            responses.append(response)
        return responses
    raise ValueError("위젯이 없습니다: " + widget_id)


def apply_sensor_line(project, line):
    key = None
    value = None
    if line.startswith("DATA:"):
        parts = line.split(":", 2)
        if len(parts) == 3:
            key = parts[1]
            value = parts[2]
    else:
        try:
            packet = json.loads(line)
            if isinstance(packet, dict) and packet.get("type") == "sensor":
                key = packet.get("k")
                value = packet.get("val")
        except ValueError:
            return
    if key is None:
        return
    try:
        number = float(value)
        if math.isfinite(number):
            value = number
    except (TypeError, ValueError):
        pass
    for widget in project["widgets"]:
        if str(widget.get("sensorKey", "")).lower() == str(key).lower():
            widget["value"] = value
            if "points" in widget and type(value) in [int, float]:
                widget["points"].append(value)
                widget["points"] = widget["points"][-12:]
