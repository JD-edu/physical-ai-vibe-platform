"""C++ bridge integration tests. Python is a test driver, not a runtime server."""
import json
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

binary = sys.argv[1]

def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]

http, tcp = free_port(), free_port()
while http == tcp:
    tcp = free_port()
base = f'http://127.0.0.1:{http}'

def request(path, body=None, method=None):
    headers = {}
    if isinstance(body, (dict, list)):
        body = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    elif isinstance(body, str):
        body = body.encode()
    req = Request(base + path, data=body, headers=headers, method=method)
    try:
        response = urlopen(req, timeout=3)
    except HTTPError as error:
        response = error
    with response:
        return response.status, response.read(), response.headers

def status():
    code, body, headers = request('/api/status')
    assert code == 200 and headers['Access-Control-Allow-Origin'] == '*'
    return json.loads(body)

def wait_for(predicate):
    for _ in range(80):
        try:
            if predicate():
                return
        except OSError:
            pass
        time.sleep(.05)
    raise AssertionError('Timed out waiting for bridge state')

with tempfile.TemporaryFile() as log:
    process = subprocess.Popen([binary, '--headless', '--host', '127.0.0.1', '--port', str(http), '--tcp-port', str(tcp)], stdout=log, stderr=log)
    try:
        wait_for(lambda: status()['server'] == 'phyvibe-cpp-bridge')
        assert status()['message_sequence'] == 0
        assert request('/api/command', method='OPTIONS')[0] == 204
        assert request('/api/command', {'command': 'a'})[0] == 503
        for body in ({'command': ''}, {'command': '\n'}, {'command': 'a\nb'}, {'command': 'x'*257}, {'command': 42}, ['a']):
            assert request('/api/command', body)[0] == 400
        assert request('/api/command', 'not json')[0] == 400
        assert request('/receive', '')[0] == 400
        for _ in range(2):
            assert request('/receive', 'DATA:temperature:25')[1] == b'OK'
        assert [item['id'] for item in status()['message_history']] == [2, 1]
        assert request('/exchange', 'DATA:humidity:58')[1] == b'DATA:humidity:58'
        assert status()['message_sequence'] == 3
        assert request('/missing')[0] == 404
        assert request('/receive', b'x'*16385)[0] == 413
        assert request('/api/status?poll=1')[0] == 200
        with socket.create_connection(('127.0.0.1', tcp), timeout=3) as a, socket.create_connection(('127.0.0.1', tcp), timeout=3) as b:
            a.settimeout(3); b.settimeout(3)
            wait_for(lambda: status()['connected_clients'] == 2)
            code, body, _ = request('/api/command', {'command': 'a'})
            assert code == 200 and json.loads(body)['sent_count'] == 2
            assert a.recv(100) == b'a\n' and b.recv(100) == b'a\n'
            request('/api/command', {'command': ' A '})
            assert a.recv(100) == b' A \n' and b.recv(100) == b' A \n'
            assert status()['latest_command'] == ' A '
            # Fragmented TCP sensor frames must wait for a full line.
            a.sendall(b'DATA:light:')
            time.sleep(.05)
            a.sendall(b'70\nDATA:distance:12\n')
            wait_for(lambda: status()['latest_message'] == 'DATA:distance:12')
        wait_for(lambda: status()['connected_clients'] == 0)
        assert request('/api/command', {'command': 'a'})[0] == 503
        # Opt-in v1 envelope and controller execution acknowledgements.
        with socket.create_connection(('127.0.0.1', tcp), timeout=3) as device:
            device.settimeout(3)
            wait_for(lambda: status()['connected_clients'] == 1)
            command = {'protocol': 'phyvibe-v1', 'command_id': 'test-a', 'command': 'a'}
            code, body, _ = request('/api/command', command)
            assert code == 202 and json.loads(body)['state'] == 'sent'
            assert device.recv(1024) == b'V1:CMD:test-a:a\n'
            assert request('/api/command', command)[0] == 200
            device.settimeout(.1)
            try:
                duplicate = device.recv(1024)
                raise AssertionError(f'Duplicate ID was resent: {duplicate!r}')
            except socket.timeout:
                pass
            device.settimeout(3)
            assert request('/api/command', {**command, 'command': 'b'})[0] == 409
            request('/receive', 'V1:ACK:unknown:OK')
            assert json.loads(request('/api/commands/test-a')[1])['state'] == 'sent'
            request('/receive', 'V1:ACK:test-a:OK')
            assert json.loads(request('/api/commands/test-a')[1])['state'] == 'acknowledged'
            request('/receive', 'V1:ACK:test-a:ERR:LATE_ERROR')
            assert json.loads(request('/api/commands/test-a')[1])['state'] == 'acknowledged'
            failed = {**command, 'command_id': 'failed', 'command': 'CMD:servo:90'}
            assert request('/api/command', failed)[0] == 202
            assert device.recv(1024) == b'V1:CMD:failed:CMD:servo:90\n'
            device.sendall(b'V1:ACK:failed:ERR:UNSUPPORTED_COMMAND\n')
            wait_for(lambda: json.loads(request('/api/commands/failed')[1])['state'] == 'failed')
            assert json.loads(request('/api/commands/failed')[1])['error'] == 'UNSUPPORTED_COMMAND'
            assert request('/api/commands/missing')[0] == 404
            for invalid in ({**command, 'command_id': 'bad:id'}, {**command, 'protocol': 'unknown'}, {**command, 'command': 'x'*65}, {**command, 'command': '한글'}):
                assert request('/api/command', invalid)[0] == 400
            timeout = {**command, 'command_id': 'timeout'}
            request('/api/command', timeout)
            assert device.recv(1024) == b'V1:CMD:timeout:a\n'
            time.sleep(5.15)
            assert json.loads(request('/api/commands/timeout')[1])['state'] == 'timed_out'
            request('/receive', 'V1:ACK:timeout:OK')
            assert json.loads(request('/api/commands/timeout')[1])['state'] == 'timed_out'
            request('/api/command', {**command, 'command_id': 'disconnect'})
            assert device.recv(1024) == b'V1:CMD:disconnect:a\n'
        wait_for(lambda: json.loads(request('/api/commands/disconnect')[1])['state'] == 'connection_lost')
        # Fragmented HTTP uploads and duplicate Content-Length rejection.
        with socket.create_connection(('127.0.0.1', http), timeout=3) as client:
            client.settimeout(3)
            client.sendall(b'POST /receive HTTP/1.1\r\nHost: localhost\r\nContent-Length: 4\r\n\r\nPI')
            time.sleep(.05)
            client.sendall(b'NG')
            assert b'200 OK' in client.recv(4096)
        assert status()['latest_message'] == 'PING'
        with socket.create_connection(('127.0.0.1', http), timeout=3) as client:
            client.settimeout(3)
            client.sendall(b'POST /receive HTTP/1.1\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\nx')
            assert b'400 Bad Request' in client.recv(4096)
        for n in range(25):
            request('/receive', f'DATA:sensor:{n}')
        assert len(status()['message_history']) == 20
        # TCP bind failure must roll back the HTTP listener and exit nonzero.
        blocked_tcp = free_port()
        rollback_http = free_port()
        with socket.socket() as blocker:
            blocker.bind(('127.0.0.1', blocked_tcp)); blocker.listen()
            failed = subprocess.run([binary, '--headless', '--host', '127.0.0.1', '--port', str(rollback_http), '--tcp-port', str(blocked_tcp)], capture_output=True, timeout=5)
            assert failed.returncode != 0 and b'ESP32 TCP port' in failed.stderr
            with socket.socket() as check:
                check.bind(('127.0.0.1', rollback_http))
    except Exception:
        log.seek(0); print(log.read().decode(), file=sys.stderr)
        raise
    finally:
        process.terminate(); process.wait(timeout=5)
    assert socket.socket().connect_ex(('127.0.0.1', http)) != 0
print('C++ bridge passed: CORS, telemetry/echo, repeated messages, raw commands, broadcast, disconnects, fragmented HTTP/TCP, validation, history limit, bind rollback, shutdown.')
