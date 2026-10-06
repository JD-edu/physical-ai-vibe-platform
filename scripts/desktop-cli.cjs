// Use the project-local Node runtime when the host Node version is older.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const root = path.join(__dirname, "..");
const localNode = path.join(root, ".desktop-tools", "node_modules", "node", "bin", "node");
const node = fs.existsSync(localNode) ? localNode : process.execPath;
const [tool, ...args] = process.argv.slice(2);
const entry = tool === "electron" ? require.resolve("electron/cli.js") : require.resolve("electron-builder/cli.js");
const child = spawn(node, [entry, ...args], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, PATH: `${path.dirname(node)}${path.delimiter}${process.env.PATH || ""}` },
});
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
