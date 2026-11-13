"""입문자는 이 파일부터 읽고 실행하세요. 기본 실행에는 추가 패키지가 필요 없습니다."""

from files import FOLDER, read_json, write_json
from compiler import make_context, compile_intent
from llm import generate
from runtime import set_slider, press_button

# 1. 여기의 값만 바꿔 보세요.
USE_LOCAL_LLM = False
CAMERA_URL = "http://192.168.0.123/stream"
LLM_URL = "http://127.0.0.1:8080"
BRIDGE_URL = "http://localhost:5000"
QUESTION = "카메라를 보면서 전진, 후진, 좌회전, 우회전, 정지로 로봇을 조종하고 공통 속도 슬라이더를 넣어 주세요."

# 2. 질문과 설정한 카메라 주소를 하나로 묶습니다.
context = make_context(QUESTION, CAMERA_URL)

# 3. LLM 문의를 켜면 실제 서버에 요청합니다.
#    꺼져 있으면 준비된 회신 예제로 나머지 과정을 연습합니다.
if USE_LOCAL_LLM:
    trace = []
    intent, project = generate(QUESTION, context, LLM_URL, trace=trace)
    write_json(FOLDER / "output" / "lesson_llm_trace.json", trace)
else:
    intent = read_json(FOLDER / "examples" / "02_camera_remote.json")
    project = compile_intent(intent, context)

# 4. 의도와 만들어진 앱 구성을 저장합니다.
write_json(FOLDER / "output" / "lesson_intent.json", intent)
write_json(FOLDER / "output" / "lesson_project.json", project)

# 5. 만들어진 화면 구성요소를 확인합니다.
print("앱 이름:", project["title"])
for widget in project["widgets"]:
    print(widget["id"], widget["type"], widget["title"])

# 6. 예제의 모터 슬라이더를 27로 바꿉니다.
#    LLM 결과의 기능 순서는 달라질 수 있으므로 종류로 찾습니다.
for widget in project["widgets"]:
    if widget["type"] == "control":
        if widget["action"]["skill"] == "set_motor":
            set_slider(project, widget["id"], 27)

# 7. 방향 버튼이 만들 명령을 확인합니다.
#    dry_run=True이므로 장치로 보내지 않고 결과만 출력합니다.
for widget in project["widgets"]:
    if widget["type"] == "button":
        results = press_button(project, widget["id"], BRIDGE_URL, dry_run=True)
        for result in results:
            print("버튼:", widget["title"], "명령:", result["command"])

print("실제 화면 실행과 장치 전송은 실행방법.md를 참고하세요.")
