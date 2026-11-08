import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { installEnvironment } from "../dist/environment.js";

function project(t) {
  const root = mkdtempSync(join(tmpdir(), "jolts-agent-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet", root]);
  writeFileSync(join(root, ".gitignore"), ".env.local\n");
  return root;
}
const token = "a".repeat(64);
const endpoint = "https://app.example.test/api/v1/requests";

test("installs without returning a credential and preserves unrelated variables", (t) => {
  const root = project(t);
  const file = join(root, ".env.local");
  writeFileSync(file, "OTHER=value\n");
  const result = installEnvironment(root, token, endpoint);
  assert.equal(result, realpathSync(file));
  assert.equal(result.includes(token), false);
  assert.equal(
    readFileSync(file, "utf8"),
    `OTHER=value\nJOLTS_API_KEY=${token}\nJOLTS_ENDPOINT=${endpoint}\n`,
  );
  assert.equal(statSync(file).mode & 0o777, 0o600);
});

test("refuses existing credentials without changing the file", (t) => {
  const root = project(t);
  const file = join(root, ".env.local");
  writeFileSync(file, "export JOLTS_API_KEY=existing\n");
  assert.throws(() => installEnvironment(root, token, endpoint), /already configured/);
  assert.equal(readFileSync(file, "utf8"), "export JOLTS_API_KEY=existing\n");
});

test("refuses unignored and tracked environment files", (t) => {
  const root = project(t);
  writeFileSync(join(root, ".gitignore"), "");
  assert.throws(() => installEnvironment(root, token, endpoint), /ignored/);
  writeFileSync(join(root, ".env.local"), "OTHER=value\n");
  execFileSync("git", ["-C", root, "add", ".env.local"]);
  writeFileSync(join(root, ".gitignore"), ".env.local\n");
  assert.throws(() => installEnvironment(root, token, endpoint), /tracked/);
});

test("refuses symbolic links and unsafe environment values", (t) => {
  const root = project(t);
  const target = join(root, "target");
  writeFileSync(target, "unchanged");
  symlinkSync(target, join(root, ".env.local"));
  assert.throws(() => installEnvironment(root, token, endpoint), /regular/);
  assert.equal(readFileSync(target, "utf8"), "unchanged");
  assert.throws(() => installEnvironment(root, "bad\nVALUE=x", endpoint), /credential/);
  assert.throws(() => installEnvironment(root, token, "https://example.test/$SECRET"), /endpoint/);
});

test("rotation replaces only the expected credential and preserves unrelated settings", (t) => {
  const root = project(t);
  const file = join(root, ".env.local");
  writeFileSync(file, "OTHER=value\n");
  installEnvironment(root, token, endpoint);
  const original = readFileSync(file, "utf8");
  assert.throws(() => installEnvironment(root, "b".repeat(64), endpoint, "0".repeat(64)));
  assert.equal(readFileSync(file, "utf8"), original);
  writeFileSync(file, original + "export JOLTS_API_KEY=unexpected\n");
  assert.throws(() =>
    installEnvironment(
      root,
      "b".repeat(64),
      endpoint,
      createHash("sha256").update(token).digest("hex"),
    ),
  );
  writeFileSync(file, original);
  installEnvironment(
    root,
    "b".repeat(64),
    endpoint,
    createHash("sha256").update(token).digest("hex"),
  );
  assert.equal(readFileSync(file, "utf8"), original.replace(token, "b".repeat(64)));
  assert.equal(statSync(file).mode & 0o777, 0o600);
});
