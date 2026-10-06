// Versioned generation contract. This is the single source for supported skills/profiles.
const PROTOCOL_V1_CATALOG = Object.freeze({
  protocol: "phyvibe-v1",
  version: 1,
  skills: {
    display_sensor: { description: "Display incoming DATA:key:value or sensor JSON", arguments: { key: "sensor key" } },
    send_text: { description: "Send exact literal text to micro:bit", arguments: { text: "1–256 single-line characters; preserve case/spaces" } },
    set_servo: { description: "Slider sends CMD:target:angle to micro:bit", arguments: { target: "servo, valve, or mouth", range: "integer 0..180" } },
    set_motor: { description: "Slider sends CMD:motor:percent to micro:bit", arguments: { range: "0..80" } },
  },
  profiles: {
    legacy: { label: "Legacy · execution unconfirmed", acknowledged: false, skills: ["display_sensor", "send_text", "set_servo", "set_motor"], description: "Existing templates; the MakeCode program must implement selected sensor keys and commands." },
    "microbit-v1-servo": { label: "Protocol v1 · micro:bit servo", acknowledged: true, skills: ["display_sensor", "send_text", "set_servo"], servoTargets: ["servo"], sensorKeys: ["temperature"], textCommands: ["a"], description: "Upload microbit/examples/protocol-v1-servo.ts. Configured servo pin accepts CMD:servo:0..180; displays a and reports temperature. Motor, valve and mouth are unavailable in this example." },
    "microbit-v1-demo": { label: "Protocol v1 · micro:bit demo", acknowledged: true, skills: ["display_sensor", "send_text"], sensorKeys: ["temperature"], textCommands: ["a"], description: "Upload physical/microbit/examples/protocol-v1-demo.ts. Displays a and reports temperature; servo/motor actions are unavailable." },
  },
});

// Included in standalone exports; no catalog or Studio dependency is needed at runtime.
async function deliverProtocolCommand(network, command, report, signal) {
  const acknowledged = network.protocol === "phyvibe-v1";
  const id = acknowledged ? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` : null;
  const body = acknowledged ? { protocol: "phyvibe-v1", command_id: id, command } : { command };
  function requestSignal() { return signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000); }
  const response = await fetch(`${network.bridgeUrl}/api/command`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: requestSignal(),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  report(`TX ${command}${id ? ` · ${id} · waiting for micro:bit ACK` : ` · ESP32 ${result.sent_count} · execution unconfirmed`}`);
  if (!acknowledged) return true;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Command monitoring cancelled; execution state is unknown");
    const response = await fetch(`${network.bridgeUrl}/api/commands/${id}`, { cache: "no-store", signal: requestSignal() });
    const status = await response.json();
    if (!response.ok) throw new Error(status.error || `HTTP ${response.status}`);
    if (status.state === "acknowledged") { report(`ACK ${id} · micro:bit reports successful execution`); return true; }
    if (status.state !== "sent") throw new Error(`${id}: ${status.state}${status.error ? ` (${status.error})` : ""}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`${id}: ACK monitoring timed out; execution state is unknown`);
}
