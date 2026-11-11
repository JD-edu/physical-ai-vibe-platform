// Shared VM harness: production scripts with a minimal editor DOM and a mocked LLM transport.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
module.exports = function createContext() {
  const nodes = new Map(),
    responses = [],
    requests = [];
  const node = (key) => {
    if (!nodes.has(key))
      nodes.set(key, {
        value: "",
        textContent: "",
        innerHTML: "",
        classList: { add() {}, remove() {} },
        addEventListener() {},
      });
    return nodes.get(key);
  };
  const context = {
    URL,
    AbortController,
    AbortSignal,
    structuredClone,
    setTimeout,
    clearTimeout,
    document: { querySelector: node },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    fetch: async (_url, options) => {
      requests.push(structuredClone(JSON.parse(options.body)));
      if (!responses.length) throw new Error("Unexpected LLM call");
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(responses.shift()) } }],
        }),
      };
    },
  };
  vm.createContext(context);
  const root = path.resolve(__dirname, "../..");
  vm.runInContext(
    ["skills.js", "camera.js", "vision.js", "intent.js", "app.js"]
      .map((file) => fs.readFileSync(path.join(root, "webapp", file), "utf8"))
      .join("\n")
      .split(/renderWidgets\(\);\s*bindEvents\(\);/)[0],
    context,
  );
  const run = (code) => vm.runInContext(code, context);
  run('state.qwenModelId="test";state.cameraUrl="http://192.168.0.123/stream"');
  const compile = (features, overrides = {}) => {
    context.intent = { version: 1, title: "테스트", features, ...overrides };
    return run(
      'compileAppIntent(intent, appIntentContext("",state.cameraUrl),SKILL_CATALOG.profiles.legacy)',
    );
  };
  return { context, run, compile, responses, requests };
};
