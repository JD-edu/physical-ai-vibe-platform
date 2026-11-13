"""의도 → 카메라, 버튼, 슬라이더 등의 실행 구성. JavaScript를 사용하지 않습니다."""

import copy
import re
from urllib.parse import urlsplit, urlunsplit
from schema import validate
from skills import PROFILE, check_permission, validate_action, make_action


def normalize_camera_url(value):
    if not isinstance(value, str) or len(value) > 2048:
        raise ValueError("카메라 주소는 문자열이어야 합니다.")
    value = value.strip()
    if not value:
        return ""
    url = urlsplit(value)
    if url.scheme not in ["http", "https"] or not url.hostname:
        raise ValueError("http://카메라IP/stream 형식으로 입력하세요.")
    if url.username or url.password or url.fragment:
        raise ValueError("카메라 URL에 계정이나 #을 넣지 마세요.")
    url.port  # 잘못된 포트 번호도 여기에서 검사합니다.
    path = url.path
    if path in ["", "/"]:
        path = "/stream"
    host = url.netloc.lower()
    return urlunsplit((url.scheme.lower(), host, path, url.query, ""))


def make_context(prompt, camera_url=""):
    urls = re.findall(r'https?://[^\s<>"\']+', prompt, re.IGNORECASE)
    unique = []
    for url in urls:
        if url not in unique:
            unique.append(url)
    return {"cameraUrl": camera_url, "explicitCameraUrls": unique}


def camera_source(feature, context):
    source_type = feature.get("input", "configured")
    if source_type == "webcam":
        if feature.get("url"):
            raise ValueError("웹캠에는 네트워크 주소를 넣지 않습니다.")
        return {"type": "webcam"}
    urls = context["explicitCameraUrls"]
    url = feature.get("url", "")
    if not url and urls:
        url = urls[0]
    if not url:
        url = context["cameraUrl"]
    if feature.get("url"):
        allowed = []
        for item in [context["cameraUrl"]] + urls:
            if item:
                allowed.append(normalize_camera_url(item))
        if normalize_camera_url(feature["url"]) not in allowed:
            raise ValueError("LLM이 지어낸 카메라 주소는 사용할 수 없습니다.")
    if source_type == "configured" and not url and feature["kind"] == "classifier":
        return {"type": "webcam"}
    return {"type": "esp32_stream", "url": normalize_camera_url(url)}


def add_widget(widgets, widget):
    widget["id"] = "feature-" + str(len(widgets) + 1)
    widgets.append(widget)
    return widget["id"]


def compile_motor(feature, widgets):
    speed = feature.get("speed", 50)
    slider_id = None
    if feature["speedControl"] == "slider":
        slider_id = add_widget(
            widgets,
            {
                "type": "control",
                "title": feature.get("title", "모터 속도"),
                "min": feature.get("min", 0),
                "max": feature.get("max", 80),
                "value": speed,
                "action": {"skill": "set_motor"},
            },
        )
    if feature.get("directions"):
        names = {
            "forward": "전진",
            "left": "좌회전",
            "right": "우회전",
            "backward": "후진",
            "stop": "정지",
        }
        for direction in ["forward", "left", "right", "backward", "stop"]:
            if direction not in feature["directions"]:
                continue
            action = {"skill": "drive_motor", "direction": direction}
            if direction == "stop":
                action["speed"] = 0
            elif slider_id:
                action["speedFrom"] = slider_id
            else:
                action["speed"] = speed
            add_widget(
                widgets,
                {"type": "button", "title": names[direction], "actions": [action]},
            )
    else:
        action = {"skill": "set_motor"}
        if slider_id:
            action["speedFrom"] = slider_id
        else:
            action["speed"] = speed
        add_widget(
            widgets, {"type": "button", "title": "모터 동작", "actions": [action]}
        )
        add_widget(
            widgets,
            {
                "type": "button",
                "title": "모터 정지",
                "actions": [{"skill": "set_motor", "speed": 0}],
            },
        )


def normalize_classifier(widget, profile):
    config = widget["action"]
    classes = config["classes"]
    labels = []
    rules = []
    for rule in config["rules"]:
        if rule["label"] not in classes or rule["label"] in labels:
            raise ValueError("분류 규칙의 클래스가 잘못되었거나 중복입니다.")
        labels.append(rule["label"])
        rules.append(validate_action(rule, profile, empty_text=True))
    config["rules"] = rules
    if "game" in config:
        if rules:
            raise ValueError("분류 규칙과 게임 중 하나만 선택하세요.")
        game = config["game"]
        if len(game["beats"]) != len(classes) * (len(classes) - 1) // 2:
            raise ValueError("모든 클래스 쌍의 승패를 지정하세요.")
        seen = []
        for pair in game["beats"]:
            if (
                len(pair) != 2
                or pair[0] == pair[1]
                or pair[0] not in classes
                or pair[1] not in classes
            ):
                raise ValueError("게임 승패 관계가 잘못되었습니다.")
            key = sorted(pair)
            if key in seen:
                raise ValueError("게임 승패 관계가 중복입니다.")
            seen.append(key)
        for key in ["winText", "lossText", "drawText"]:
            game[key] = game.get(key, "")
            if game[key]:
                validate_action({"skill": "send_text", "text": game[key]}, profile)
    widget["wide"] = True
    return widget


def normalize_widgets(widgets, profile):
    result = []
    for item in widgets:
        item = copy.deepcopy(item)
        kind = item["type"]
        if kind in ["camera_stream", "classifier"]:
            item["wide"] = True
            if kind == "classifier":
                item = normalize_classifier(item, profile)
            result.append(item)
            continue
        widget = {
            "id": item["id"],
            "type": kind,
            "title": item["title"],
            "icon": "◇",
            "value": item.get("value", 0),
            "unit": item.get("unit", ""),
            "min": item.get("min", 0),
            "max": item.get("max", 100),
            "threshold": item.get("threshold", 10),
            "wide": False,
        }
        if "points" in item:
            widget["points"] = item["points"]
        if kind == "button":
            widget["actions"] = []
            for action in item["actions"]:
                widget["actions"].append(validate_action(action, profile))
        elif kind == "control":
            action = item["action"]
            check_permission(action, profile)
            maximum = 80
            widget["command"] = "CMD:motor"
            if action["skill"] == "set_servo":
                maximum = 180
                widget["command"] = "CMD:" + action["target"]
            widget["min"] = max(0, widget["min"])
            widget["max"] = min(maximum, widget["max"])
            if widget["max"] <= widget["min"]:
                raise ValueError("슬라이더 최댓값은 최솟값보다 커야 합니다.")
            widget["value"] = max(widget["min"], min(widget["max"], widget["value"]))
            widget["action"] = action
        else:
            check_permission(item["action"], profile)
            widget["action"] = item["action"]
            widget["sensorKey"] = item["action"]["key"]
        result.append(widget)
    return result


def compile_intent(intent, context=None, profile=PROFILE):
    validate(intent)
    if intent.get("unsupported"):
        raise ValueError("현재 지원하지 않는 기능: " + ", ".join(intent["unsupported"]))
    if not intent["features"]:
        raise ValueError("앱에 필요한 기능이 없습니다.")
    if context is None:
        context = make_context("")
    widgets = []
    classified_sources = []
    preview_sources = []
    for feature in intent["features"]:
        if feature["kind"] == "classifier":
            classified_sources.append(camera_source(feature, context))
    for feature in intent["features"]:
        kind = feature["kind"]
        title = feature.get("title")
        if kind == "camera":
            source = camera_source(feature, context)
            if source in classified_sources or source in preview_sources:
                continue
            preview_sources.append(source)
            add_widget(
                widgets,
                {
                    "type": "camera_stream",
                    "title": title or "카메라",
                    "action": {"skill": "camera_stream", "source": source},
                },
            )
        elif kind == "classifier":
            rules = []
            for rule in feature.get("deviceRules", []):
                action = make_action(rule["effect"], profile, empty_text=True)
                action["label"] = rule["label"]
                rules.append(action)
            config = {
                "skill": "image_classifier",
                "model": "mobilenet",
                "source": camera_source(feature, context),
                "classes": feature["classes"],
                "confidence": feature.get("confidence", 0.8),
                "rules": rules,
            }
            if "game" in feature:
                config["game"] = copy.deepcopy(feature["game"])
            add_widget(
                widgets,
                {
                    "type": "classifier",
                    "title": title or "카메라 이미지 분류",
                    "action": config,
                },
            )
        elif kind == "motor":
            compile_motor(feature, widgets)
        elif kind == "servo":
            if feature["control"] == "slider":
                add_widget(
                    widgets,
                    {
                        "type": "control",
                        "title": title or "서보 각도",
                        "action": {"skill": "set_servo", "target": feature["target"]},
                        "min": feature.get("min", 0),
                        "max": feature.get("max", 180),
                        "value": feature.get("value", 90),
                    },
                )
            else:
                for angle in feature["angles"]:
                    effect = {
                        "kind": "servo_angle",
                        "target": feature["target"],
                        "angle": angle,
                    }
                    add_widget(
                        widgets,
                        {
                            "type": "button",
                            "title": (title or "서보") + " " + str(angle) + "°",
                            "actions": [make_action(effect, profile)],
                        },
                    )
        elif kind == "sensor":
            view = feature.get("view", "metric")
            widget = {
                "type": view,
                "title": title or feature["key"],
                "unit": feature.get("unit", ""),
                "value": 0,
                "min": feature.get("min", 0),
                "max": feature.get("max", 100),
                "threshold": feature.get("threshold", 10),
                "action": {"skill": "display_sensor", "key": feature["key"]},
            }
            if view == "chart":
                widget["points"] = [0, 0]
            add_widget(widgets, widget)
        elif kind == "macro":
            actions = []
            for effect in feature["effects"]:
                actions.append(make_action(effect, profile))
            add_widget(
                widgets,
                {"type": "button", "title": title or "명령 전송", "actions": actions},
            )
        else:
            raise ValueError("컴파일러가 없는 기능입니다: " + kind)
    if len(widgets) > 8:
        raise ValueError(
            "실행 위젯은 최대 8개입니다. 필요한 위젯 수: " + str(len(widgets))
        )
    return {"title": intent["title"], "widgets": normalize_widgets(widgets, profile)}
