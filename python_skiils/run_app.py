#!/usr/bin/env python3
"""내보낸 Python 앱 실행. LLM 서버와 편집기는 필요 없습니다."""
import argparse
from files import FOLDER, read_json
from ui import run_app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--send", action="store_true", help="실제 브릿지 전송 허용")
    parser.add_argument("--bridge-url")
    args = parser.parse_args()
    project = read_json(FOLDER / "project.json")
    bridge_url = args.bridge_url or project.get("network", {}).get(
        "bridgeUrl", "http://localhost:5000"
    )
    run_app(project, bridge_url, dry_run=not args.send, models_folder=FOLDER / "models")


if __name__ == "__main__":
    main()
