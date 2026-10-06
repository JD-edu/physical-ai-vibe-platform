# Ubuntu setup: independent Studio and C++ bridge

This guide applies to `/home/jdedu/physical-ai-vibe-platform`, Ubuntu 24.04 x64. Version 2.0 separates the C++ network bridge from Electron Studio. Do not use the old 1.0 packages that bundled a Python backend.

## 1. Build and launch the bridge

GCC, CMake, and Qt5 development libraries are already available on this PC. On a fresh machine:

```bash
sudo apt update
sudo apt install build-essential cmake qtbase5-dev
```

```bash
cd /home/jdedu/physical-ai-vibe-platform
npm run build:bridge
npm run test:bridge
./physical/bridge-server/build/phyvibe-bridge
```

Click **Start server** in the bridge window. The UI has Start/Stop, editable HTTP/TCP ports, connected ESP32 count, and bidirectional RX/TX monitoring. The default ports are 5000/5001. Closing Studio never stops this process. See [bridge documentation](../physical/bridge-server/README.md) for direct CMake commands without npm, headless mode, and optional installation.

## 2. Launch Studio in development

Electron dependencies and a project-local Node 22 runtime are already installed. The host Node version is 18; the project wrapper automatically selects its local Node 22.

The uninstalled development Electron binary needs the sandbox helper configured once:

```bash
cd /home/jdedu/physical-ai-vibe-platform
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
npm start
```

Repeat the helper setup after reinstalling Electron if the helper is replaced. Do not run Studio itself with sudo. No Python static web server is needed for Electron: it loads the Studio files directly.

Studio opens even when the bridge is stopped. Set its bridge URL to `http://127.0.0.1:5000` and connect when you need device data. Customer webapps use the same URL; remote devices use this PC's LAN IP.

## 3. Build a Studio installer

```bash
npm test
npm run dist
```

Version 2.1.1 outputs:

- `dist/phyvibe-studio-2.1.1-amd64.deb`
- `dist/phyvibe-studio-2.1.1-x86_64.AppImage`
- `dist/linux-unpacked/phyvibe-studio`

These packages contain the authoring Studio only. The C++ bridge executable is built and launched independently; it is not copied into Electron resources.

Install the Ubuntu package:

```bash
sudo apt install ./dist/phyvibe-studio-2.1.1-amd64.deb
phyvibe-studio
```

For a rebuild with the same version, close Studio and use `sudo apt install --reinstall ./dist/phyvibe-studio-2.1.1-amd64.deb`. For releases, bump `version` in `package.json` and use the new filename.

Use the `.deb` on this Ubuntu machine: its install scripts configure Chromium sandbox support. The AppImage may need FUSE and Ubuntu sandbox setup. Do not add `--no-sandbox` to normal launch commands. Administrator installation is performed from your terminal with your Ubuntu password.

## 4. Restore Electron build dependencies if missing

The project already has `package.json`, a lockfile, and electron-builder configuration. Do not run `npm init` again or import it into Electron Forge.

```bash
sudo apt install nodejs npm
cd /home/jdedu/physical-ai-vibe-platform
npm install --prefix .desktop-tools --no-audit --no-fund node@22.23.3
export PATH="/home/jdedu/physical-ai-vibe-platform/.desktop-tools/node_modules/.bin:$PATH"
node --version
npm ci
```

The local Node check should show `v22.23.3`. `npm ci` installs Electron and electron-builder according to the lockfile. Repeat the development sandbox-helper commands before running `npm start`.

No Python virtual environment, Flask, Waitress, or PyInstaller is needed for either runtime or Electron packaging. CMake's network test driver uses Python3 only during tests; it can be disabled with `-DBUILD_TESTING=OFF`.

## 5. Start Qwen separately

From your model directory:

```bash
./llama.cpp/build/bin/llama-server \
  --model ./Qwen3-8B-Q4_K_M/Qwen3-8B-Q4_K_M.gguf \
  --n-gpu-layers 99 --ctx-size 4096 \
  --host 127.0.0.1 --port 8080
```

Choose Local Qwen at `http://127.0.0.1:8080` in Studio. Electron browser settings are separate from Chrome's. The Qwen process is needed for generation; the C++ bridge is needed for physical device traffic.

## Troubleshooting

| Issue | Action |
|---|---|
| Bridge Start fails | Read the UI error; check ports using `ss -ltnp` |
| Studio opens but network connection fails | Launch C++ bridge, click Start, check the HTTP URL |
| RX data arrives but widgets do not change | Match `DATA:<key>:<value>` keys to the widget bindings |
| Commands return 503 | ESP32 has no persistent TCP command connection; Step 5 echo-only firmware cannot receive these commands |
| Electron sandbox error | Configure the development helper or install the `.deb` |
| Node engine error | Use the project-local Node 22 PATH before `npm ci` |
| Installed Studio is stale | Rebuild and reinstall the 2.0 `.deb`, then relaunch |
| LLM disconnected | Check `curl http://127.0.0.1:8080/v1/models` |

## Source map

| File | Responsibility |
|---|---|
| `electron/main.cjs` | Studio window, native Save dialog, menus; no bridge process management |
| `package.json` | Electron packaging and independent CMake build/test commands |
| `scripts/desktop-cli.cjs` | Selects Node runtime for Electron |
| `scripts/build-bridge.sh` | CMake build of the separate C++ application |
| `physical/bridge-server/CMakeLists.txt` | C++/Qt build and CTest configuration |
| `physical/bridge-server/src/` | Network server and bridge desktop UI |
| `tests/test_cpp_bridge.py` | HTTP/TCP integration-test client |
