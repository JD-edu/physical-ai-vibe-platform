# Physical AI Vibe Coding Platform

자연어로 피지컬 AI 대시보드를 만들고 micro:bit와 ESP32를 제어하는 브라우저 기반 스튜디오입니다. AI 생성은 사용자 PC에서 실행하는 **Qwen3 8B + llama.cpp**를 기본으로 사용합니다.

## Protocol v1

실행 ACK와 장치별 스킬 검증을 추가했습니다. [Protocol v1 규격과 첫 테스트](protocol/v1.md)를 참고하세요. Studio는 2.1.1, 독립 C++ 브릿지는 2.1.0입니다. microbit/ 확장 0.1.2은 Protocol v1 서보 명령과 실행 ACK 블록을 제공합니다. 기존 장치는 Legacy 프로필로 계속 사용할 수 있습니다.

## 가장 빠른 실행 순서

브라우저 Studio와 LLM은 아래 두 터미널에서 실행합니다. 실제 장치 통신에는 별도의 C++ 브릿지 앱을 실행하고 Start server를 누릅니다.

1. 터미널 1에서 Qwen3 8B 서버를 `8080` 포트로 실행합니다.
2. 터미널 2에서 웹 서버를 `3000` 포트로 실행합니다.
3. Chrome 또는 Edge로 `http://localhost:3000/webapp/`에 접속합니다.

```text
Qwen3 8B (llama.cpp)  http://localhost:8080
          ↓ OpenAI 호환 API
PHYVIBE 웹 스튜디오     http://localhost:3000/webapp/
          ↓ HTTP (Wi-Fi / Ethernet)
독립 C++ 네트워크 서버      http://서버_PC_IP:5000
          ↓ Wi-Fi / TCP 5001
ESP32 Wi-Fi 브릿지 → micro:bit 컨트롤러 (MakeCode)
```

> llama.cpp는 `8080`, 네트워크 브릿지는 HTTP `5000` 및 TCP `5001`을 사용합니다. micro:bit 프로그래밍은 MakeCode에서 별도로 진행합니다.

## 1. 준비물

- Chrome 또는 Edge 최신 버전
- Python 3: 웹앱 정적 서버 실행용
- llama.cpp 실행 파일
- Qwen3 8B의 GGUF 모델 파일
- 권장 메모리: Q4 양자화 모델 기준 여유 RAM/VRAM 약 6GB 이상

설치 여부를 확인합니다.

```bash
python3 --version
llama --version
```

기존 llama.cpp 빌드를 사용하는 경우 다음 명령 중 하나가 동작할 수 있습니다.

```bash
llama-server --help
./llama-server --help
./build/bin/llama-server --help
```

Windows에서는 다음과 같이 확인합니다.

```powershell
python --version
llama-server.exe --help
```

## 2. llama.cpp 준비

### 방법 A: 이미 설치되어 있는 경우

터미널에서 실행 파일 위치를 확인합니다.

Linux/macOS:

```bash
command -v llama
command -v llama-server
```

Windows PowerShell:

```powershell
Get-Command llama -ErrorAction SilentlyContinue
Get-Command llama-server.exe -ErrorAction SilentlyContinue
```

소스에서 직접 빌드했다면 보통 실행 파일은 다음 위치에 있습니다.

```text
llama.cpp/build/bin/llama-server
llama.cpp/build/bin/Release/llama-server.exe
```

### 방법 B: 새로 설치하는 경우

Linux/macOS에서는 llama.cpp 공식 설치 스크립트를 사용할 수 있습니다.

```bash
curl -LsSf https://llama.app/install.sh | sh
llama cli --version
```

Windows에서는 [llama.cpp Releases](https://github.com/ggml-org/llama.cpp/releases)에서 운영체제와 GPU에 맞는 미리 빌드된 압축 파일을 받아 원하는 폴더에 압축을 풉니다. 압축을 푼 폴더 안의 `llama-server.exe`를 사용합니다.

직접 빌드하려면 llama.cpp 저장소 루트에서 다음을 실행합니다.

```bash
cmake -B build
cmake --build build --config Release -t llama-server
```

## 3. Qwen3 8B GGUF 파일 찾기

이미 모델을 내려받았다면 확장자가 `.gguf`인 파일을 찾습니다.

Linux/macOS 예:

```bash
find "$HOME" -type f -iname '*qwen*8b*.gguf' 2>/dev/null
```

Windows PowerShell 예:

```powershell
Get-ChildItem "$HOME" -Filter "*qwen*8b*.gguf" -File -Recurse -ErrorAction SilentlyContinue
```

찾은 경로를 기록해 둡니다. 예시는 다음과 같습니다.

```text
/home/user/models/Qwen3-8B-Q4_K_M.gguf
C:\Users\user\models\Qwen3-8B-Q4_K_M.gguf
```

모델이 없다면 Hugging Face에서 Qwen3 8B의 **GGUF Instruct/Chat 모델**을 내려받습니다. 일반 PC에서는 `Q4_K_M` 양자화가 용량과 품질의 균형이 무난합니다. 모델 파일은 저장소에 커밋하지 말고 별도의 `models` 폴더에 보관하세요.

## 4. Qwen3 8B 서버 실행

### 최신 llama.cpp 명령

설치한 버전에서 `llama serve`가 지원된다면 다음 명령을 사용합니다.

```bash
llama serve \
  -m /실제/경로/Qwen3-8B-Q4_K_M.gguf \
  --host 127.0.0.1 \
  --port 8080 \
  --alias qwen3-8b \
  -c 8192
```

### 기존 llama-server 명령

`llama serve`가 없고 `llama-server`가 있다면 다음 명령을 사용합니다.

```bash
llama-server \
  -m /실제/경로/Qwen3-8B-Q4_K_M.gguf \
  --host 127.0.0.1 \
  --port 8080 \
  --alias qwen3-8b \
  -c 8192
```

소스 빌드 폴더에서 직접 실행하는 경우:

```bash
./build/bin/llama-server \
  -m /실제/경로/Qwen3-8B-Q4_K_M.gguf \
  --host 127.0.0.1 \
  --port 8080 \
  --alias qwen3-8b \
  -c 8192
```

Windows PowerShell에서는 줄바꿈 문자로 백틱을 사용합니다.

```powershell
.\llama-server.exe `
  -m "C:\Users\user\models\Qwen3-8B-Q4_K_M.gguf" `
  --host 127.0.0.1 `
  --port 8080 `
  --alias qwen3-8b `
  -c 8192
```

### GPU를 사용하는 경우

GPU 지원 버전의 llama.cpp를 설치했다면 다음 옵션을 추가할 수 있습니다.

```text
-ngl 99
```

예:

```bash
llama-server -m /실제/경로/Qwen3-8B-Q4_K_M.gguf --host 127.0.0.1 --port 8080 --alias qwen3-8b -c 8192 -ngl 99
```

GPU 메모리가 부족하거나 서버가 종료되면 `-ngl 99`를 제거해 CPU로 실행하거나, `-ngl 20`처럼 숫자를 낮춥니다. 메모리가 부족하면 컨텍스트 크기도 `-c 4096`으로 낮춥니다.

서버 터미널에 모델 로딩 완료 및 HTTP 서버 시작 메시지가 나타날 때까지 기다립니다. 이 터미널은 웹앱을 사용하는 동안 닫지 마세요.

## 5. LLM 서버 연결 확인

새 터미널을 열어 다음 주소를 확인합니다.

Linux/macOS:

```bash
curl http://localhost:8080/health
curl http://localhost:8080/v1/models
```

Windows PowerShell:

```powershell
curl.exe http://localhost:8080/health
curl.exe http://localhost:8080/v1/models
```

정상이면 `/health`는 `{"status":"ok"}`를 반환하고, `/v1/models` 결과에는 `qwen3-8b` 또는 GGUF 파일 경로가 표시됩니다.

간단한 생성 테스트:

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3-8b","messages":[{"role":"user","content":"안녕하세요라고 답해줘"}],"stream":false}'
```

Windows PowerShell:

```powershell
$body = '{"model":"qwen3-8b","messages":[{"role":"user","content":"안녕하세요라고 답해줘"}],"stream":false}'
curl.exe http://localhost:8080/v1/chat/completions -H "Content-Type: application/json" -d $body
```

## 6. PHYVIBE 웹앱 실행

LLM 서버 터미널은 그대로 두고 두 번째 터미널을 엽니다. 이 저장소의 최상위 폴더로 이동합니다.

Linux/macOS:

```bash
cd /이/저장소의/실제/경로/physical-AI-vibe-coding-platform
python3 -m http.server 3000
```

Windows PowerShell:

```powershell
cd "C:\이\저장소의\실제\경로\physical-AI-vibe-coding-platform"
python -m http.server 3000
```

브라우저에서 다음 주소를 엽니다.

```text
http://localhost:3000/webapp/
```

웹앱은 시작하면서 `http://localhost:8080/v1/models`를 자동 확인합니다.

- Qwen 서버가 준비되어 있으면 대기 화면이 자동으로 닫힙니다.
- 서버가 꺼져 있으면 대기 화면이 유지되고 3초마다 다시 연결합니다.
- 이 상태에서 터미널 1의 Qwen 서버를 실행하면 새로고침 없이 자동 연결됩니다.
- `지금 다시 연결` 버튼으로 즉시 재검사할 수도 있습니다.

생성한 사용자 웹앱은 Wi-Fi 또는 Ethernet으로 HTTP/HTTPS 서버에 연결합니다. 네트워크 연결 및 독립 실행 HTML 내보내기는 `webapp/README.md`를 참고하세요.

## 7. 종료 및 다음 실행

각 서버를 실행한 터미널에서 `Ctrl+C`를 누르면 종료됩니다.

다음에 다시 사용할 때는 아래 두 단계만 반복하면 됩니다.

터미널 1:

```bash
llama-server -m /실제/경로/Qwen3-8B-Q4_K_M.gguf --host 127.0.0.1 --port 8080 --alias qwen3-8b -c 8192
```

터미널 2:

```bash
cd /이/저장소의/실제/경로/physical-AI-vibe-coding-platform
python3 -m http.server 3000
```

브라우저:

```text
http://localhost:3000/webapp/
```

## 문제 해결

### `llama-server: command not found`

실행 파일이 있는 폴더로 이동해 `./llama-server`로 실행하거나 전체 경로를 사용합니다.

```bash
/home/user/llama.cpp/build/bin/llama-server --help
```

### 웹앱에서 Qwen 연결 대기 화면이 계속 표시됨

1. llama.cpp 명령에 `--port 8080`이 있는지 확인합니다.
2. `curl http://localhost:8080/health`가 성공하는지 확인합니다.
3. 모델 로딩이 끝날 때까지 기다립니다. 로딩 중에는 일시적으로 HTTP 503이 반환될 수 있습니다.
4. 웹앱과 llama.cpp를 같은 PC에서 실행했는지 확인합니다.
5. 브라우저 개발자 도구의 Console에서 CORS 또는 네트워크 오류를 확인합니다.

CORS 오류가 발생하면 llama.cpp 실행 옵션에 로컬 웹앱 출처를 허용합니다.

```bash
--cors-origins http://localhost:3000
```

### `Address already in use` 또는 포트 사용 중

- 웹앱은 `3000`
- 장치 브릿지는 HTTP `5000`, ESP32 명령 TCP `5001`
- llama.cpp는 `8080`

다른 프로그램이 `8080`을 사용 중이면 그 프로그램을 종료한 뒤 llama.cpp를 다시 실행합니다. 다른 포트를 사용하면 스튜디오의 AI 설정에서 로컬 LLM 서버 URL을 해당 주소로 변경하세요.

### 모델 로딩 중 메모리 부족

- 더 작은 양자화 모델을 사용합니다. 예: `Q4_K_M`
- 컨텍스트를 `-c 4096`으로 낮춥니다.
- GPU 옵션 `-ngl 99`를 제거하거나 수치를 낮춥니다.
- 다른 GPU 사용 프로그램을 종료합니다.

### GGUF를 찾을 수 없음

`-m` 뒤에 폴더가 아닌 실제 `.gguf` 파일의 전체 경로를 지정해야 합니다. 경로에 공백이 있으면 따옴표로 감쌉니다.

```bash
llama-server -m "/home/user/My Models/Qwen3-8B-Q4_K_M.gguf" --port 8080
```

## 프로젝트 구성

```text
.
├── physical/
│   ├── microbit/             # MakeCode 확장
│   ├── esp32/                # ESP32 펌웨어
│   └── bridge-server/        # 독립 C++ 네트워크 서버와 시작/정지 UI
├── webapp/                   # PHYVIBE 웹 스튜디오
└── tutorials/                # 단계별 실습 자료
```

세부 웹앱 기능은 `webapp/README.md`, 하드웨어 실행과 배선 방법은 각 `physical` 하위 폴더의 README를 참고하세요.
# physical-ai-vibe-platform

## Ubuntu desktop app

Electron 기반 Studio는 `electron/README.md`, 별도로 실행하는 C++ 브릿지는 `physical/bridge-server/README.md`를 참고하세요. 빌드 결과는 `dist/`의 `.deb` 및 `.AppImage`입니다. 데스크톱 앱은 별도 정적 웹 서버 없이 실행되며 llama.cpp는 따로 실행합니다.

Electron 설치, Ubuntu 실행 파일 생성 및 문제 해결의 상세 순서는 [Ubuntu Electron setup guide](electron/UBUNTU_SETUP.md)를 참고하세요. 이미 만들어진 앱을 설치하려면 가이드의 Part 1만 진행하면 됩니다.

## Standalone C++ bridge (architecture v2)

Studio and exported customer webapps use the same external network bridge. Electron does not bundle, start, or stop it.

```bash
npm run build:bridge
npm run test:bridge
./physical/bridge-server/build/phyvibe-bridge
```

Click **Start server** in its window. The default HTTP/TCP ports are 5000/5001. Use `http://127.0.0.1:5000` from this PC and the server PC's LAN address from other devices. Qwen remains on 8080. See [C++ bridge setup](physical/bridge-server/README.md).
