# PHYVIBE Studio desktop app

Electron wraps the authoring interface only. It does not embed, launch, stop, or package a bridge server.

Run the independent [C++ bridge](../physical/bridge-server/README.md) separately. Browser Studio and customer webapps connect to that same bridge over HTTP. llama.cpp also remains a separate process.

See [Ubuntu setup guide](UBUNTU_SETUP.md) for installation and rebuilding.

```bash
npm start        # Development Studio
npm test         # Studio / harness / architecture checks
npm run dist     # Ubuntu Studio AppImage + .deb; no bridge inside
```

The native HTML Save dialog is retained. Closing Studio does not affect the bridge. Electron settings are stored separately from Chrome settings, so configure Qwen and the bridge URL on the first desktop launch.
