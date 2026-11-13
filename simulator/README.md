# PHYVIBE 2D 시뮬레이터

저장소 루트에서 두 터미널을 엽니다.

```bash
npm run simulator
python3 -m http.server 3000
```

브라우저에서 `http://localhost:3000/webapp/`을 열고 **Studio 상단의 실행 대상 → 2D 시뮬레이터**를 선택한 뒤 오른쪽 **네트워크 연결** 스위치를 켭니다. 좁은 화면에서는 **장치** 탭을 열면 연결 스위치가 보입니다. 내장 데모 엔진을 사용하면 Qwen 없이도 `전진 후진 좌우회전 정지 버튼이 있는 로봇 조종 웹앱`을 생성할 수 있습니다. 생성한 버튼을 누르면 라이브 뷰의 2D 로봇이 움직입니다. 내보낸 HTML에도 실행 대상 선택기와 2D 화면이 포함됩니다. 내보낸 앱에서는 **연결**을 눌러야 명령을 보낼 수 있습니다.

시뮬레이터 기본 주소는 `http://127.0.0.1:5002`이며, 장치 패널의 브릿지 서버 URL에서 변경할 수 있습니다. 실제 장치를 선택하면 이전에 설정한 실제 브릿지 URL로 돌아갑니다. 시뮬레이터는 Studio와 별도 프로세스이므로 Studio를 닫아도 실행됩니다. 다른 PC에서 접속할 경우 `PHYVIBE_SIM_HOST=0.0.0.0 npm run simulator`로 실행하고 그 PC의 LAN 주소를 입력합니다.

시뮬레이터는 기존 브릿지와 같은 `POST /api/command`, `GET /api/status` 응답을 제공합니다. `CMD:motor:<direction>:<speed>`의 방향은 `forward`, `backward`, `left`, `right`, `stop`이고 속도는 0–80입니다. `CMD:motor:<speed>`, `CMD:servo:<angle>`, `CMD:valve:<angle>`, `CMD:mouth:<angle>`, `MOT:<left>:<right>`도 처리합니다. `GET /api/sim/state`는 2D 화면용 좌표와 방향을 제공합니다. `x`, `y`, `heading`, `speed`, `servo` 센서 키는 `DATA:<key>:<value>`로 발행합니다. 로봇은 정사각형 영역 안에서 이동하며 좌우 명령은 제자리 회전입니다. 임의 텍스트 명령은 브릿지 호환성을 위해 수신하지만 로봇 동작으로 해석하지 않습니다.

이 화면은 교육용 간단 운동 모델입니다. 실제 모터의 가속, 미끄러짐, 충돌 물리는 재현하지 않습니다. `sent_count: 1`은 시뮬레이터가 명령을 수신했다는 뜻입니다.

```bash
npm run test:simulator
```
