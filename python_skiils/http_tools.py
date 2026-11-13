"""HTTP는 다른 프로그램에 요청을 보내고 응답을 받는 약속입니다."""

import json
from urllib.request import Request, build_opener, ProxyHandler
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit


def base_url(value):
    value = value.strip().rstrip("/")
    parsed = urlsplit(value)
    if (
        parsed.scheme not in ["http", "https"]
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.fragment
        or parsed.query
    ):
        raise ValueError("서버 주소는 http://localhost:8080 같은 형식이어야 합니다.")
    parsed.port
    return value


def request_json(url, data=None, timeout=120):
    headers = {"Accept": "application/json"}
    body = None
    if data is not None:
        body = json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = Request(url, data=body, headers=headers)
    opener = build_opener(ProxyHandler({}))
    try:
        with opener.open(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read(2000).decode("utf-8", errors="replace")
        raise ValueError("HTTP " + str(error.code) + ": " + detail) from error
    except URLError as error:
        raise ValueError("서버에 연결할 수 없습니다: " + str(error.reason)) from error


def bridge_status(bridge_url):
    return request_json(base_url(bridge_url) + "/api/status", timeout=5)


def send_command(command, bridge_url, dry_run=True):
    if dry_run:
        return {
            "dry_run": True,
            "command": command,
            "message": "미리보기만 수행했습니다. 실제 전송 없음.",
        }
    response = request_json(
        base_url(bridge_url) + "/api/command", {"command": command}, timeout=5
    )
    if "error" in response:
        raise ValueError(str(response["error"]))
    return response
