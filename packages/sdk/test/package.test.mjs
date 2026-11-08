import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));

test("packed SDK installs independently with working exports and TypeScript declarations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jolts-sdk-package-"));
  try {
    const [packed] = Object.values(
      JSON.parse(
        execFileSync("npm", ["pack", "./packages/sdk", "--json", "--pack-destination", directory], {
          cwd: root,
          encoding: "utf8",
        }),
      ),
    );
    assert.ok(
      packed.files.every(
        ({ path }) =>
          path.startsWith("dist/") || ["package.json", "README.md", "LICENSE"].includes(path),
      ),
    );
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    execFileSync(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--offline",
        join(directory, packed.filename),
      ],
      { cwd: directory },
    );
    const manifest = JSON.parse(
      await readFile(join(directory, "node_modules/@jolts/sdk/package.json"), "utf8"),
    );
    assert.deepEqual(manifest.dependencies ?? {}, {});
    await writeFile(
      join(directory, "verify.mjs"),
      `
      import assert from 'node:assert/strict';
      import { createClient } from '@jolts/sdk/server';
      import { loadAd, renderAd, observeAd, mountAd } from '@jolts/sdk/browser';
      for (const fn of [createClient, loadAd, renderAd, observeAd, mountAd]) assert.equal(typeof fn, 'function');
    `,
    );
    execFileSync(process.execPath, ["verify.mjs"], { cwd: directory });
    await writeFile(
      join(directory, "verify.ts"),
      `
      import { createClient, type AdRequest } from '@jolts/sdk/server';
      import { renderAd, mountAd } from '@jolts/sdk/browser';
      export const mount = mountAd;
      const client = createClient({ endpoint: 'https://api.example.test', apiKey: 'synthetic' });
      export async function show(input: AdRequest, element: HTMLElement) {
        return renderAd(element, await client.requestAd(input));
      }
    `,
    );
    execFileSync(
      join(root, "node_modules/.bin/tsc"),
      [
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--module",
        "NodeNext",
        "--target",
        "ES2022",
        "verify.ts",
      ],
      { cwd: directory },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
