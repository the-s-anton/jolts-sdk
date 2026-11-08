import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));

test("packed agent installs independently and starts the MCP executable", {
  timeout: 30000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "jolts-agent-package-"));
  let child;
  try {
    const [archive] = Object.values(
      JSON.parse(
        execFileSync(
          "npm",
          ["pack", "./packages/agent", "--json", "--pack-destination", directory],
          { cwd: root, encoding: "utf8" },
        ),
      ),
    );
    assert.ok(
      archive.files.every(
        ({ path }) =>
          path.startsWith("dist/") || ["package.json", "README.md", "LICENSE"].includes(path),
      ),
    );
    await writeFile(join(directory, "package.json"), JSON.stringify({ private: true }));
    execFileSync(
      "npm",
      [
        "install",
        "--offline",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        join(directory, archive.filename),
      ],
      { cwd: directory },
    );
    child = spawn(
      process.execPath,
      [
        join(directory, "node_modules/.bin/jolts-agent"),
        directory,
        "https://app.example.test/authorizations",
      ],
      { cwd: directory, stdio: ["pipe", "pipe", "pipe"] },
    );
    const lines = createInterface({ input: child.stdout });
    const response = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Packed agent did not initialize")), 5000);
      lines.on("line", (line) => {
        const message = JSON.parse(line);
        if (message.id === 1) {
          clearTimeout(timeout);
          resolve(message);
        }
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "packed-consumer", version: "1.0" },
        },
      }) + "\n",
    );
    const initialized = await response;
    assert.equal(initialized.error, undefined);
    assert.equal(initialized.result.serverInfo.name, "jolts-publisher-setup");
    lines.close();
  } finally {
    if (child && child.exitCode === null) {
      const stopped = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await stopped;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
