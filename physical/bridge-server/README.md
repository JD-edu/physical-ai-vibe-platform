# 통신 브리지 서버

ESP32가 전송한 데이터를 HTTP로 받고, 웹 화면에서 입력한 명령을 TCP로 ESP32에 전달하는 Flask 서버입니다.

```bash
python -m venv .venv
source .venv/bin/activate
pip install flask
python server.py
```

- 웹/HTTP 포트: `5000`
- ESP32 명령 TCP 포트: `5001`
