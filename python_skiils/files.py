"""JSON 파일 읽기/쓰기. 한글이 그대로 보이도록 UTF-8을 사용합니다."""

import json
from pathlib import Path

FOLDER = Path(__file__).resolve().parent


def read_json(filename):
    with open(filename, "r", encoding="utf-8") as file:
        return json.load(file)


def write_json(filename, data):
    path = Path(filename)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2, allow_nan=False)
        file.write("\n")
