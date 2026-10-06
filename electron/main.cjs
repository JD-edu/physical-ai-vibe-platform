const { app, BrowserWindow, dialog, Menu, shell } = require("electron");
const path = require("node:path");

const smokeTest = process.argv.includes("--smoke-test");
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 960, minWidth: 900, minHeight: 650,
    title: "PHYVIBE Studio", show: !smokeTest,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://makecode.microbit.org/")) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", event => event.preventDefault());
  mainWindow.webContents.session.on("will-download", (_event, item) => {
    item.setSaveDialogOptions({
      title: "Save customer webapp",
      defaultPath: path.join(app.getPath("documents"), item.getFilename()),
      filters: [{ name: "HTML webapp", extensions: ["html"] }],
    });
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  if (smokeTest) {
    const timeout = setTimeout(() => { console.error("Renderer smoke test timed out"); app.exit(1); }, 20000);
    mainWindow.webContents.once("did-finish-load", async () => {
      try {
        const result = await mainWindow.webContents.executeJavaScript(`({ title: document.title, harness: typeof HARNESS_SKILLS === 'object', exportButton: Boolean(document.querySelector('#exportBtn')), serial: Boolean(document.querySelector('#serialBtn')) })`);
        console.log(JSON.stringify({ ...result, bridge: "external standalone service" }));
        if (!result.harness || !result.exportButton || result.serial) throw new Error("Studio did not load correctly");
        clearTimeout(timeout); app.quit();
      } catch (error) { console.error(error); app.exit(1); }
    });
  }
  mainWindow.loadFile(path.join(__dirname, "..", "webapp", "index.html"));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { mainWindow?.restore(); mainWindow?.focus(); });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: "File", submenu: [{ role: "quit" }] },
      { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }] },
      { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }] },
      { label: "Help", submenu: [{ label: "Network architecture", click: () => dialog.showMessageBox({
        message: "Studio connects to an external C++ bridge.",
        detail: "Start PHYVIBE C++ Bridge separately and click Start server. Enter its HTTP URL in Studio and customer webapps. Studio does not start or stop the bridge. Qwen/llama.cpp is also started separately.",
      }) }] },
    ]));
    createWindow();
  }).catch(error => { console.error(error); app.exit(1); });
}
app.on("window-all-closed", () => { app.quit(); });
