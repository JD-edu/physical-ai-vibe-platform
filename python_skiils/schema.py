"""LLM의 의도가 약속한 JSON 형식을 지키는지 검사합니다.

스키마 = 필요한 항목, 자료형, 허용 범위를 적은 설명서입니다.
JS판과 같은 계약의 JSON 사본을 읽습니다. Node나 JavaScript 실행은 필요 없습니다.
"""

import math
import re
from files import FOLDER, read_json

INTENT_SCHEMA = read_json(FOLDER / "intent_schema.json")


def validate(value, schema=None, path="intent"):
    # dict 안의 dict를 검사할 때 이 함수를 다시 부릅니다. 이를 '재귀'라고 합니다.
    if schema is None:
        schema = INTENT_SCHEMA

    if "oneOf" in schema:
        for choice in schema["oneOf"]:
            matches = isinstance(value, dict)
            for key, rule in choice["properties"].items():
                if "const" in rule:
                    if not isinstance(value, dict) or value.get(key) != rule["const"]:
                        matches = False
            if matches:
                validate(value, choice, path)
                return
        raise ValueError(path + ": 지원하지 않는 기능 종류 또는 선택입니다.")

    if "const" in schema:
        if type(value) is bool or value != schema["const"]:
            raise ValueError(path + ": 고정값이 다릅니다.")
    if "enum" in schema and value not in schema["enum"]:
        raise ValueError(path + ": 허용 목록에 없는 값입니다.")

    data_type = schema.get("type")
    if data_type == "object":
        if not isinstance(value, dict):
            raise ValueError(path + ": 딕셔너리가 필요합니다.")
        for key in schema.get("required", []):
            if key not in value:
                raise ValueError(path + ": 필요한 항목이 없습니다: " + key)
        for key in value:
            if key not in schema["properties"]:
                raise ValueError(path + ": 알 수 없는 항목: " + key)
            validate(value[key], schema["properties"][key], path + "." + key)

    elif data_type == "array":
        if not isinstance(value, list):
            raise ValueError(path + ": 리스트가 필요합니다.")
        if len(value) < schema.get("minItems", 0) or len(value) > schema.get(
            "maxItems", 100000
        ):
            raise ValueError(path + ": 항목 개수가 범위를 벗어났습니다.")
        seen = []
        for number, item in enumerate(value):
            if schema.get("uniqueItems") and item in seen:
                raise ValueError(path + ": 중복된 값이 있습니다.")
            seen.append(item)
            validate(item, schema["items"], path + "[" + str(number) + "]")

    elif data_type == "string":
        if not isinstance(value, str):
            raise ValueError(path + ": 문자열이 필요합니다.")
        if schema.get("minLength", 0) > 0 and not value.strip():
            raise ValueError(path + ": 빈 문자열입니다.")
        if len(value) < schema.get("minLength", 0) or len(value) > schema.get(
            "maxLength", 100000
        ):
            raise ValueError(path + ": 문자열 길이가 범위를 벗어났습니다.")
        if "pattern" in schema and re.fullmatch(schema["pattern"], value) is None:
            raise ValueError(path + ": 사용할 수 없는 문자입니다.")

    elif data_type in ["integer", "number"]:
        if type(value) not in [int, float] or not math.isfinite(value):
            raise ValueError(path + ": 유한한 숫자가 필요합니다.")
        if data_type == "integer" and value != int(value):
            raise ValueError(path + ": 정수가 필요합니다.")
        if value < schema.get("minimum", -math.inf) or value > schema.get(
            "maximum", math.inf
        ):
            raise ValueError(path + ": 숫자가 허용 범위를 벗어났습니다.")
