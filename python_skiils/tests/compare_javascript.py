"""개발용 호환성 검사: 같은 의도를 JS판과 Python판에 넣고 결과 전체를 비교합니다.

일반 Python 실행에는 Node가 필요 없습니다. 이 검사만 기존 JS 구현을 비교 대상으로 부릅니다.
"""

import json
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from files import FOLDER, read_json
from compiler import compile_intent, make_context

cases = []
for filename in sorted((FOLDER / "examples").glob("*.json")):
    if "unsupported" not in filename.name:
        cases.append(read_json(filename))
for camera in [False, True]:
    for control in ["slider", "fixed"]:
        for speed in [0, 27, 80]:
            features = []
            if camera:
                features.append({"kind": "camera"})
            features.append(
                {
                    "kind": "motor",
                    "speedControl": control,
                    "speed": speed,
                    "directions": ["forward", "backward", "left", "right", "stop"],
                }
            )
            cases.append({"version": 1, "title": "조합", "features": features})
cases.append(
    {
        "version": 1,
        "title": "서보 버튼",
        "features": [
            {
                "kind": "servo",
                "target": "servo",
                "control": "buttons",
                "angles": [30, 150],
            }
        ],
    }
)
cases.append(
    {
        "version": 1,
        "title": "동작 버튼",
        "features": [{"kind": "motor", "speedControl": "slider"}],
    }
)
script = """
const fs=require('fs');
const harness=require('./camera/tests/intent_context.cjs')();
const intents=JSON.parse(fs.readFileSync(0,'utf8'));
const results=[];
for(const intent of intents){
 harness.context.intent=intent;
 results.push(harness.run('compileAppIntent(intent,appIntentContext("","http://camera/stream"),SKILL_CATALOG.profiles.esp32)'));
}
process.stdout.write(JSON.stringify({projects:results,schema:harness.run("APP_INTENT_SCHEMA"),catalog:harness.run("SKILL_CATALOG")}));
"""
result = subprocess.run(
    ["node", "-e", script],
    input=json.dumps(cases),
    text=True,
    capture_output=True,
    cwd=FOLDER.parent,
    check=True,
)
payload = json.loads(result.stdout)
assert payload["schema"] == read_json(
    FOLDER / "intent_schema.json"
), "의도 계약 사본을 갱신하세요."
assert payload["catalog"] == read_json(
    FOLDER / "skill_catalog.json"
), "스킬 계약 사본을 갱신하세요."
expected = payload["projects"]
context = make_context("", "http://camera/stream")
for number, intent in enumerate(cases):
    actual = compile_intent(intent, context)
    if actual != expected[number]:
        print("불일치:", number)
        print("Python:", json.dumps(actual, ensure_ascii=False, indent=2))
        print("JS:", json.dumps(expected[number], ensure_ascii=False, indent=2))
        raise SystemExit(1)
print("PASS: JavaScript/Python 의도 컴파일 결과 전체 일치:", len(cases), "개")
