import assert from "node:assert/strict";
import { constants, publicEncrypt } from "node:crypto";
import { test } from "node:test";
import { Setup } from "../dist/setup.js";

const authorization = "https://app.example.test/api/v1/apps/example/authorizations";
const token = "a".repeat(64);
test("approval installs the decrypted token without exposing it in results", async () => {
  let publicKey;
  let installed;
  let installs = 0;
  let acknowledgements = 0;
  const setup = new Setup(".", authorization, {
    fetch: async (_url, options) => {
      if (_url.endsWith("/installation")) {
        assert.equal(options.headers.get("Authorization"), `Bearer ${token}`);
        assert.ok(installed);
        if (++acknowledgements === 1) return new Response(null, { status: 503 });
        return Response.json({ status: "installed" });
      }
      if (options.method === "POST") {
        publicKey = JSON.parse(options.body).public_key;
        return Response.json({
          approval_url: "https://app.example.test/approval",
          status_url: authorization + "/one",
        });
      }
      return Response.json({
        status: "approved",
        encrypted_token: publicEncrypt(
          { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
          Buffer.from(token),
        ).toString("base64"),
        requests_url: "https://app.example.test/api/v1/requests",
        configuration_url: "https://app.example.test/api/v1/configuration",
        installation_url: "https://app.example.test/api/v1/credentials/one/installation",
      });
    },
    install: (...args) => {
      installed = args;
      installs += 1;
      return "/project/.env.local";
    },
  });
  const begin = await setup.begin();
  assert.equal(begin.status, "pending");
  await assert.rejects(setup.finish(), /could not complete/);
  const results = await Promise.all([setup.finish(), setup.finish()]);
  assert.equal(installed[1], token);
  assert.equal(installs, 1);
  assert.deepEqual(results[0], { status: "installed", file: "/project/.env.local" });
  assert.equal(JSON.stringify([begin, results]).includes(token), false);
  assert.equal(JSON.stringify([begin, results]).includes("PRIVATE KEY"), false);
});

test("does not follow an approval URL to another origin", async () => {
  const setup = new Setup(".", authorization, {
    fetch: async () =>
      Response.json({
        approval_url: "https://attacker.example/approve",
        status_url: authorization,
      }),
    install: () => {
      throw new Error("must not install");
    },
  });
  await assert.rejects(setup.begin(), /Invalid setup response/);
});

test("pending and denied approval never install credentials", async () => {
  let status = "pending";
  let starts = 0;
  const setup = new Setup(".", authorization, {
    fetch: async (_url, options) => {
      if (options.method === "POST") starts += 1;
      return Response.json(
        options.method === "POST"
          ? {
              approval_url: "https://app.example.test/approval",
              status_url: authorization + "/one",
            }
          : { status },
      );
    },
    install: () => {
      throw new Error("must not install");
    },
  });
  await setup.begin();
  assert.deepEqual(await setup.finish(), { status: "pending" });
  status = "denied";
  assert.deepEqual(await setup.finish(), { status: "denied" });
  await setup.begin();
  assert.equal(starts, 2);
});
