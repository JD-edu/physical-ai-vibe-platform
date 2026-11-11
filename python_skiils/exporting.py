"""Python 앱 내보내기. LLM 서버와 원래 PhyVibe 폴더 없이 실행합니다."""

from pathlib import Path
import shutil
from files import FOLDER, write_json


RUNTIME_FILES = [
    "files.py",
    "schema.py",
    "skills.py",
    "compiler.py",
    "http_tools.py",
    "runtime.py",
    "camera.py",
    "cnn.py",
    "ui.py",
    "exporting.py",
    "run_app.py",
    "intent_schema.json",
    "skill_catalog.json",
    "requirements.txt",
    "requirements-cnn.txt",
]


def export_app(project, destination, models_folder=None):
    destination = Path(destination)
    if destination.exists() and any(destination.iterdir()):
        raise ValueError("내보낼 폴더는 비어 있어야 합니다. 새 폴더를 선택하세요.")
    destination.mkdir(parents=True, exist_ok=True)
    for filename in RUNTIME_FILES:
        shutil.copy2(FOLDER / filename, destination / filename)
    write_json(destination / "project.json", project)
    if models_folder is not None and Path(models_folder).is_dir():
        shutil.copytree(models_folder, destination / "models", dirs_exist_ok=True)
    readme = "Python 앱 실행\n\npython3 run_app.py\n\n"
    readme += "처음에는 전송 미리보기입니다. 실제 전송: python3 run_app.py --send\n"
    readme += "카메라 설치: pip install -r requirements.txt\nCNN 설치: pip install -r requirements-cnn.txt\n"
    readme += (
        "Tkinter 필요(Ubuntu: sudo apt install python3-tk). Python 3.10~3.12 권장.\n"
    )
    readme += "LLM과 에디터는 필요 없습니다. 장치 제어에는 기존 브릿지가 필요합니다.\n"
    readme += "MobileNet 기본 가중치는 처음 사용할 때 인터넷에서 내려받습니다.\n"
    (destination / "실행방법.txt").write_text(readme, encoding="utf-8")
    return destination
