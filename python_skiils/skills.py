"""실제 스킬과 명령 생성. LLM은 이 명령 문자열을 만들지 않습니다."""

import copy
import math
from files import FOLDER, read_json

CATALOG = read_json(FOLDER / "skill_catalog.json")
PROFILE = CATALOG["profiles"]["esp32"]
DIRECTIONS = ["forward", "backward", "left", "right", "stop"]
TARGETS = ["servo", "valve", "mouth"]


def integer(value, low, high):
    if (
        type(value) not in [int, float]
        or not math.isfinite(value)
        or value != int(value)
    ):
        raise ValueError("정수를 입력하세요.")
    if value < low or value > high:
        raise ValueError(str(low) + "부터 " + str(high) + " 사이여야 합니다.")
    return int(value)


def check_permission(action, profile=PROFILE):
    skill = action.get("skill")
    if skill not in profile["skills"]:
        raise ValueError("이 장치에서 허용하지 않은 스킬: " + str(skill))
    limits = {
        "send_text": ["textCommands", "text"],
        "set_servo": ["servoTargets", "target"],
        "display_sensor": ["sensorKeys", "key"],
    }
    if skill in limits:
        limit_name, value_name = limits[skill]
        if limit_name in profile and action.get(value_name) not in profile[limit_name]:
            raise ValueError(
                "이 장치에서 허용하지 않은 값: " + str(action.get(value_name))
            )


def make_action(effect, profile=PROFILE, empty_text=False):
    # 의도에 적힌 효과 → 실행 스킬. 읽기 쉽게 if/elif로 나눴습니다.
    kind = effect["kind"]
    if kind == "transmit_text":
        action = {"skill": "send_text", "text": effect["text"]}
    elif kind == "motor_speed":
        action = {"skill": "set_motor", "speed": effect["speed"]}
    elif kind == "drive":
        speed = effect["speed"]
        if effect["direction"] == "stop":
            speed = 0
        action = {
            "skill": "drive_motor",
            "direction": effect["direction"],
            "speed": speed,
        }
    elif kind == "servo_angle":
        action = {
            "skill": "set_servo",
            "target": effect["target"],
            "angle": effect["angle"],
        }
    else:
        raise ValueError("알 수 없는 효과: " + kind)
    return validate_action(action, profile, empty_text)


def validate_action(action, profile=PROFILE, empty_text=False):
    action = copy.deepcopy(action)
    if empty_text and action.get("skill") == "send_text" and action.get("text") == "":
        if "send_text" not in profile["skills"]:
            raise ValueError("이 장치에서 허용하지 않은 스킬: send_text")
    else:
        check_permission(action, profile)
    skill = action["skill"]
    if skill == "send_text":
        text = action.get("text")
        if not isinstance(text, str) or len(text) > 256 or "\n" in text or "\r" in text:
            raise ValueError("전송 문자열은 256자 이하 한 줄이어야 합니다.")
        if not empty_text and not text.strip():
            raise ValueError("빈 문자열은 버튼으로 전송하지 않습니다.")
    elif skill in ["set_motor", "drive_motor"]:
        if skill == "drive_motor":
            if action.get("direction") not in DIRECTIONS:
                raise ValueError("모터 방향이 잘못되었습니다.")
            if action["direction"] == "stop":
                action.pop("speedFrom", None)
                action["speed"] = 0
        if "speedFrom" in action:
            if not isinstance(action["speedFrom"], str) or not action["speedFrom"]:
                raise ValueError("슬라이더 ID가 필요합니다.")
            return action
        speed = integer(action.get("speed"), 0, 80)
        action["speed"] = speed
        if skill == "drive_motor":
            action["text"] = "CMD:motor:" + action["direction"] + ":" + str(speed)
        else:
            action["text"] = "CMD:motor:" + str(speed)
    elif skill == "set_servo":
        if action.get("target") not in TARGETS:
            raise ValueError("서보 대상이 잘못되었습니다.")
        if "angle" in action:
            angle = integer(action["angle"], 0, 180)
            action["angle"] = angle
            action["text"] = "CMD:" + action["target"] + ":" + str(angle)
    return action


def resolve_action(action, widgets):
    # 버튼을 누르는 바로 그 순간의 슬라이더 값을 읽습니다.
    if action["skill"] not in ["set_motor", "drive_motor"]:
        return action["text"]
    if action.get("direction") == "stop":
        return "CMD:motor:stop:0"
    current = copy.deepcopy(action)
    if "speedFrom" in current:
        found = False
        for widget in widgets:
            if widget["id"] == current["speedFrom"]:
                if (
                    widget["type"] != "control"
                    or widget["action"]["skill"] != "set_motor"
                ):
                    raise ValueError("모터 슬라이더가 아닙니다.")
                current["speed"] = widget["value"]
                found = True
        if not found:
            raise ValueError("연결된 모터 슬라이더가 없습니다.")
        del current["speedFrom"]
    current = validate_action(current)
    return current["text"]


def classify_decision(config, label, confidence, opponent=None):
    # 낮은 신뢰도에서는 새 명령을 만들지 않습니다. 자동 주행 기능은 아닙니다.
    if (
        label not in config["classes"]
        or type(confidence) not in [int, float]
        or not math.isfinite(confidence)
        or confidence < config["confidence"]
    ):
        return {"outcome": "uncertain", "text": ""}
    if "game" not in config:
        for rule in config["rules"]:
            if rule["label"] == label:
                return {"outcome": "classified", "text": rule["text"]}
        return {"outcome": "classified", "text": ""}
    if opponent not in config["classes"]:
        raise ValueError("게임 상대의 선택이 잘못되었습니다.")
    game = config["game"]
    if label == opponent:
        return {"outcome": "draw", "text": game["drawText"]}
    if [label, opponent] in game["beats"]:
        return {"outcome": "win", "text": game["winText"]}
    return {"outcome": "loss", "text": game["lossText"]}
