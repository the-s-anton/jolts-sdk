import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { test } from "node:test";

test("stdio exposes setup tools and returns a safe failure before approval", {
  timeout: 10000,
}, async (t) => {
  const child = spawn(
    process.execPath,
    [
      new URL("../dist/server.js", import.meta.url).pathname,
      "/nonexistent-project",
      "https://app.example.test/setup",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  t.after(() => child.kill());
  const waiting = new Map();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    waiting.get(message.id)?.(message);
  });
  function request(id, method, params) {
    return new Promise((resolve) => {
      waiting.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  const initialized = await request(1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "setup-test", version: "1.0" },
  });
  assert.equal(initialized.result.serverInfo.name, "jolts-publisher-setup");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const listed = await request(2, "tools/list", {});
  assert.deepEqual(listed.result.tools.map((tool) => tool.name).sort(), [
    "begin_publisher_setup",
    "finish_publisher_setup",
    "replace_publisher_connection",
  ]);
  const finished = await request(3, "tools/call", {
    name: "finish_publisher_setup",
    arguments: {},
  });
  assert.equal(finished.result.isError, true);
  assert.equal(JSON.stringify(finished).includes("PRIVATE KEY"), false);
  lines.close();
});
