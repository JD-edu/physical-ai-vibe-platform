# 쉬운 Python으로 읽는 PhyVibe 스킬과 로컬 LLM 처리

현재 PhyVibe의 **스킬 → 로컬 LLM 문의 → 회신 → 의도 검증 → 앱 구성 → 명령 실행**을 Python으로 구현했습니다. Python 파일 안에서 기존 JavaScript를 실행하는 방식이 아닙니다.

입문자가 읽기 쉽도록 함수, `if/elif/else`, `for`, 리스트, 딕셔너리를 중심으로 작성했습니다. 화면·HTTP·카메라·CNN 라이브러리 사용 코드는 각 파일로 분리했습니다. 기존 웹앱과 브릿지 서버는 그대로 사용할 수 있습니다.

## 먼저 실행해 보기

저장소 최상위 폴더에서 다음을 실행합니다. LLM 서버와 실제 장치는 필요하지 않습니다.

```bash
python3 python_skiils/start_here.py
```

준비한 의도 예제를 읽고, 카메라와 조종 앱을 구성하고, 속도 27의 방향 명령을 출력합니다. 장치로 전송하지 않습니다.

그 다음 읽을 문서:

- [동작원리.md](동작원리.md): 누가 무엇을 하는지, 파일을 어떤 순서로 읽는지.
- [실행방법.md](실행방법.md): 설치, 실제 Qwen 문의, 화면 실행, 카메라·CNN, 장치 전송, 독립 앱 내보내기.

## 구현 범위

| 기능 | Python 구현 |
|---|---|
| 현재 스킬 목록과 장치 프로필 | `skill_catalog.json`, `skills.py` |
| 동일한 의도 계약 | `intent_schema.json`, `schema.py` |
| 로컬 LLM 모델 확인 | `/v1/models` GET |
| 로컬 LLM 문의·회신 | `/v1/chat/completions` POST, 회신 JSON 추출 |
| 잘못된 회신 | 계약 검사 후 일반 수정 요청 1회 |
| 미지원 요청 | 명시적 오류, 다른 앱으로 대체하지 않음 |
| 의도 → 앱 구성 | `compiler.py`, ID·슬라이더 참조를 Python이 생성 |
| 모터·서보·문자·순차 명령 | `skills.py`, `runtime.py`, 기존 HTTP 브릿지 사용 |
| 센서 표시 | metric, gauge, chart, alert와 수신 패킷 반영 |
| ESP32 영상·PC 웹캠 | `camera.py`, 직접 수신·최신 프레임·재연결 |
| CNN 수집·학습·추론 | `cnn.py`, 실제 Keras MobileNetV2 + 작은 분류기 |
| 분류 규칙·가위바위보 | 클래스·신뢰도·효과·게임 판정 |
| 학습 모델 저장·복원 | `head.keras`, `metadata.json` |
| 화면 | `ui.py`, Python Tkinter |
| 독립 앱 내보내기 | Python 실행 파일·구성·학습 모델을 새 폴더에 복사 |

## JavaScript판과의 관계

**의도와 장치 명령 처리 흐름을 Python으로 재현한 데스크톱 실행판**입니다. 브라우저 HTML/CSS나 Electron 자체를 Python 문법으로 바꾼 것은 아닙니다. 내보낸 결과도 HTML이 아니라 `run_app.py`로 실행하는 Python 앱입니다.

현재 의도 스키마와 스킬 목록은 JS판 계약의 JSON 사본입니다. 일반 Python 실행에는 Node가 필요하지 않습니다. JS 계약이 바뀌면 이 사본과 Python 구현도 함께 갱신하고 호환성 검사를 수행해야 합니다. 두 구현이 자동으로 계속 동기화되는 구조는 아닙니다.

CNN은 두 구현 모두 고정된 MobileNetV2 특징 추출기와 사용자 분류기를 사용하지만, Python은 Keras 구현과 가중치를 사용합니다. 브라우저의 TensorFlow.js 파일과 Python의 `.keras` 파일은 직접 교환하지 않습니다. 같은 사진의 점수까지 동일하다고 보장하지 않습니다.

로컬 LLM 서버와 기존 브릿지 서버는 기존 프로그램을 사용합니다. Python판이 LLM 서버나 펌웨어를 다시 만드는 것은 아닙니다. Python 앱에서 직접 두 서버의 HTTP API를 호출합니다.

## 파일 지도

```text
python_skiils/
  start_here.py           입문용 7단계 예제
  main.py                 명령줄 실행 진입점
  llm.py                  문의·회신·수정 요청
  prompt_rules.txt         LLM에 첨부할 공통 기능 해석 안내
  compiler.py             의도 → 실행 구성
  skills.py               스킬·권한·명령·분류 판정
  schema.py               의도 자료형과 범위 검사
  http_tools.py           HTTP 요청·브릿지 전송
  runtime.py              버튼·슬라이더·센서 실행
  camera.py               영상 직접 수신
  cnn.py                  CNN 수집·학습·추론·저장
  ui.py                   Python 화면
  exporting.py            독립 앱 폴더 만들기
  run_app.py              내보낸 앱 실행
  intent_schema.json      현재 JS판과 같은 의도 계약
  skill_catalog.json      현재 스킬 목록과 프로필
  examples/               의도 JSON과 자연어 예제
  tests/                  흐름·호환성·화면·실제 CNN 검사
```

`output/`에는 실행 결과가 저장됩니다. LLM 회신 원문은 `llm_trace.json`, 의도는 `intent.json`, 최종 앱 구성은 `project.json`입니다. 실패한 회신의 검증 오류도 추적 파일에서 확인할 수 있습니다.
