"""1. 모델 확인 → 2. 문의 → 3. 회신 JSON 추출 → 4. 검증·컴파일.

eval(), exec()로 LLM의 코드를 실행하지 않습니다. 응답은 데이터로만 읽습니다.
"""

import json
import re
from schema import INTENT_SCHEMA, validate
from files import FOLDER
from compiler import compile_intent
from skills import PROFILE
from http_tools import base_url, request_json


def find_model(llm_url):
    response = request_json(base_url(llm_url) + "/v1/models", timeout=5)
    if not response.get("data"):
        raise ValueError("로컬 LLM 서버에 모델이 없습니다.")
    return response["data"][0]["id"]


def system_message(context, profile=PROFILE):
    schema_text = json.dumps(INTENT_SCHEMA, ensure_ascii=False, separators=(",", ":"))
    message = (FOLDER / "prompt_rules.txt").read_text(encoding="utf-8")
    message += "\nSchema: " + schema_text
    message += "\nDevice profile: " + json.dumps(profile, ensure_ascii=False)
    message += "\nCamera context: " + json.dumps(context, ensure_ascii=False)
    return message


def extract_intent(text):
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"```(?:json)?", "", text, flags=re.IGNORECASE)
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < start:
        raise ValueError("LLM 회신에서 JSON을 찾지 못했습니다.")
    return json.loads(text[start : end + 1])


def generate(prompt, context, llm_url="http://127.0.0.1:8080", model=None, trace=None):
    if trace is None:
        trace = []
    if model is None:
        model = find_model(llm_url)
    messages = [
        {"role": "system", "content": system_message(context)},
        {"role": "user", "content": prompt},
    ]
    # 질문별 예외 대신, 동일한 계약 검사와 한 번의 일반 수정 요청만 사용합니다.
    for attempt in range(2):
        request = {
            "model": model,
            "stream": False,
            "messages": messages,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
        }
        response = request_json(base_url(llm_url) + "/v1/chat/completions", request)
        raw = response["choices"][0]["message"]["content"]
        trace.append({"attempt": attempt + 1, "model": model, "raw_response": raw})
        try:
            intent = extract_intent(raw)
            validate(intent)
            if intent.get("unsupported"):
                raise ValueError(
                    "현재 지원하지 않는 기능: " + ", ".join(intent["unsupported"])
                )
            project = compile_intent(intent, context)
            return intent, project
        except ValueError as error:
            trace[-1]["validation_error"] = str(error)
            if str(error).startswith("현재 지원하지 않는 기능:") or attempt == 1:
                raise
            messages.append({"role": "assistant", "content": raw})
            messages.append(
                {
                    "role": "user",
                    "content": "Intent validation failed: "
                    + str(error)
                    + ". Return complete corrected intent JSON. Preserve all requested capabilities and literal values. No widgets or code.",
                }
            )
