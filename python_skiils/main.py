#!/usr/bin/env python3
"""가장 먼저 읽을 파일: 사용자 요청부터 실행까지 순서대로 진행합니다."""
import argparse
import json
from pathlib import Path
from files import FOLDER, read_json, write_json
from compiler import compile_intent, make_context
from skills import CATALOG
from llm import generate
from runtime import set_slider, press_button
from exporting import export_app


def show_project(project):
    print("\n[앱]", project["title"])
    for widget in project["widgets"]:
        print(" -", widget["id"], widget["type"], widget["title"])
        if widget["type"] in ["button", "control"]:
            previews = press_button(
                project, widget["id"], "http://localhost:5000", dry_run=True
            )
            for preview in previews:
                print("     명령 미리보기:", preview["command"])


def main():
    parser = argparse.ArgumentParser(
        description="쉬운 Python PhyVibe: 의도 해석 → 앱 구성 → 실행"
    )
    parser.add_argument("--prompt", help="LLM에 문의할 자연어 요청")
    parser.add_argument("--prompt-file", help="긴 요청을 적은 UTF-8 텍스트 파일")
    parser.add_argument("--intent", help="LLM 없이 이미 저장한 의도 JSON으로 실행")
    parser.add_argument("--project", help="이미 구성한 앱 JSON으로 실행")
    parser.add_argument("--camera-url", default="", help="http://카메라IP/stream")
    parser.add_argument("--llm-url", default="http://127.0.0.1:8080")
    parser.add_argument("--model", help="생략하면 /v1/models에서 모델을 찾습니다.")
    parser.add_argument("--bridge-url", help="기본값 http://localhost:5000")
    parser.add_argument("--output", default=str(FOLDER / "output"))
    parser.add_argument(
        "--gui", action="store_true", help="Python 조종·카메라 화면 열기"
    )
    parser.add_argument("--send", action="store_true", help="명령을 실제 브릿지에 전송")
    parser.add_argument(
        "--press", action="append", default=[], help="실행할 위젯 ID, 여러 번 지정 가능"
    )
    parser.add_argument(
        "--set", action="append", default=[], help="슬라이더 변경 예: feature-2=27"
    )
    parser.add_argument("--export", help="독립 앱을 저장할 비어 있는 폴더")
    parser.add_argument("--list-skills", action="store_true")
    args = parser.parse_args()

    if args.list_skills:
        print(json.dumps(CATALOG, ensure_ascii=False, indent=2))
        return
    if (
        sum(
            [
                bool(args.prompt),
                bool(args.prompt_file),
                bool(args.intent),
                bool(args.project),
            ]
        )
        > 1
    ):
        raise ValueError(
            "--prompt, --prompt-file, --intent, --project 중 하나만 사용하세요."
        )

    output = Path(args.output)
    models_folder = output / "models"
    trace = []
    if args.project:
        print("[1] 저장한 앱 읽기")
        project = read_json(args.project)
        # 원래 프로젝트 옆의 학습 모델을 사용합니다.
        models_folder = Path(args.project).resolve().parent / "models"
    else:
        print("[1] 사용자 요청 준비")
        prompt = args.prompt
        if args.prompt_file:
            prompt = Path(args.prompt_file).read_text(encoding="utf-8")
        if not prompt and not args.intent:
            prompt = input("어떤 앱을 만들까요? ").strip()
        context = make_context(prompt or "", args.camera_url)
        if args.intent:
            print("[2] 저장한 의도 읽기 → [3] 계약 검증·앱 구성")
            intent = read_json(args.intent)
            project = compile_intent(intent, context)
        else:
            print("[2] 로컬 LLM 문의 → 회신 수신 → [3] 계약 검증·앱 구성")
            try:
                intent, project = generate(
                    prompt, context, args.llm_url, args.model, trace
                )
            finally:
                # 실패한 응답도 남기므로 어디서 잘못되었는지 볼 수 있습니다.
                write_json(output / "llm_trace.json", trace)
        write_json(output / "intent.json", intent)
        write_json(output / "context.json", context)
        write_json(output / "prompt.json", {"prompt": prompt or ""})

    if args.bridge_url is None:
        args.bridge_url = project.get("network", {}).get(
            "bridgeUrl", "http://localhost:5000"
        )
    project["network"] = {"bridgeUrl": args.bridge_url, "deviceProfile": "legacy"}
    print("[4] 실행 값 적용·명령 구성")
    for setting in args.set:
        widget_id, separator, value = setting.partition("=")
        if not separator:
            raise ValueError("--set feature-2=27처럼 입력하세요.")
        set_slider(project, widget_id, float(value))
    write_json(output / "project.json", project)
    show_project(project)
    for widget_id in args.press:
        response = press_button(
            project, widget_id, args.bridge_url, dry_run=not args.send
        )
        print("[버튼 실행]", json.dumps(response, ensure_ascii=False))
    if args.export:
        destination = export_app(project, args.export, models_folder)
        print("[5] 독립 앱 내보내기:", destination)
        print("실행: python3", destination / "run_app.py")
    if args.gui:
        print("[5] Python 화면 실행")
        from ui import run_app

        run_app(
            project, args.bridge_url, dry_run=not args.send, models_folder=models_folder
        )
    print("\n결과 폴더:", output.resolve())


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, ImportError) as error:
        print("오류:", error)
        raise SystemExit(1)
