const assert = require("node:assert/strict");
const { context, run, compile } = require("./intent_context.cjs")();
const directions = ["forward", "backward", "left", "right", "stop"];
for (const camera of [false, true])
  for (const speedControl of ["slider", "fixed"])
    for (const speed of [0, 27, 80]) {
      const features = [
        ...(camera ? [{ kind: "camera" }] : []),
        { kind: "motor", speedControl, speed, directions },
      ];
      const project = compile(features);
      context.widgets = project.widgets;
      assert.equal(new Set(project.widgets.map((w) => w.id)).size, project.widgets.length);
      const sliders = project.widgets.filter((w) => w.type === "control");
      assert.equal(sliders.length, speedControl === "slider" ? 1 : 0);
      for (const direction of directions) {
        const action = project.widgets
          .flatMap((w) => w.actions || [])
          .find((a) => a.direction === direction);
        assert(action);
        context.actions = [action];
        assert.equal(
          run("resolveButtonCommands(actions,widgets)[0]"),
          `CMD:motor:${direction}:${direction === "stop" ? 0 : speed}`,
        );
        if (direction === "stop") assert.equal(action.speedFrom, undefined);
        else assert.equal(action.speedFrom, sliders[0]?.id);
      }
      if (sliders.length) {
        sliders[0].value = 63;
        context.actions = project.widgets.find((w) =>
          w.actions?.some((a) => a.direction === "forward"),
        ).actions;
        assert.equal(run("resolveButtonCommands(actions,widgets)[0]"), "CMD:motor:forward:63");
      }
    }
const project = compile([
  { kind: "motor", speedControl: "slider", directions: ["forward"], speed: 20 },
  { kind: "servo", target: "servo", control: "slider", value: 90 },
  { kind: "motor", speedControl: "slider", directions: ["left"], speed: 60 },
]);
const motors = project.widgets.filter((w) => w.action?.skill === "set_motor");
const forward = project.widgets.find((w) => w.actions?.[0].direction === "forward").actions[0];
const left = project.widgets.find((w) => w.actions?.[0].direction === "left").actions[0];
assert.equal(forward.speedFrom, motors[0].id);
assert.equal(left.speedFrom, motors[1].id);
context.widgets = project.widgets;
motors[0].value = 11;
motors[1].value = 77;
context.actions = [forward];
assert.equal(run("resolveButtonCommands(actions,widgets)[0]"), "CMD:motor:forward:11");
context.actions = [left];
assert.equal(run("resolveButtonCommands(actions,widgets)[0]"), "CMD:motor:left:77");
for (const speedControl of ["slider", "fixed"]) {
  const plan = compile([{ kind: "motor", speedControl, speed: 25 }]);
  context.widgets = plan.widgets;
  for (const button of plan.widgets.filter((w) => w.type === "button")) {
    context.actions = button.actions;
    assert(
      ["CMD:motor:25", "CMD:motor:0"].includes(run("resolveButtonCommands(actions,widgets)[0]")),
    );
  }
}
context.items = [
  {
    id: "bad",
    type: "button",
    actions: [{ skill: "drive_motor", direction: "forward", speedFrom: "invented" }],
  },
];
assert.throws(() => run("normalizeWidgets(items)"), /invalid motor slider reference/);
assert.equal(compile([{ kind: "motor", speedControl: "fixed" }]).widgets.length, 2);
assert.equal(
  compile([{ kind: "motor", speedControl: "fixed", directions: ["left"] }]).widgets[0].actions[0]
    .direction,
  "left",
);
// Standalone exports use the same resolver and compiled configuration, with no intent module dependency.
const vm = require("node:vm");
const standalone = { widgets: project.widgets, actions: [left] };
vm.createContext(standalone);
vm.runInContext(run("resolveButtonCommands.toString()"), standalone);
assert.equal(
  vm.runInContext("resolveButtonCommands(actions,widgets)[0]", standalone),
  "CMD:motor:left:77",
);
console.log(
  "PASS: camera x motor slider/fixed x 0/27/80, deterministic IDs, separate motor groups, servo independence, current speed at click, stop=0, standalone resolver.",
);
