import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createClient } from "../dist/server.js";

const input = {
  opportunity_id: "answer-1",
  answer_id: "answer-1",
  completed_at: new Date().toISOString(),
  origin: "https://publisher.example",
  context: { summary: "Comparing shoes" },
  privacy: { contextual_ads: true, measurement: true },
};

async function withApi(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

function delivery(base) {
  return {
    id: "delivery-1",
    answer_id: "answer-1",
    format: "card",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    server_time: new Date().toISOString(),
    ttl_ms: 60_000,
    disclosure: "Sponsored · Test ad",
    creative: { sponsor: "Example", headline: "Shoes", description: "A test card" },
    actions: { click_url: `${base}/preview` },
    measurement: {
      url: `${base}/events`,
      tokens: { rendered: "rendered-token", viewable: "viewable-token", click: "click-token" },
      minimum_visible_ratio: 0.5,
      continuous_visible_ms: 1000,
    },
  };
}

test("server sends explicit context once and returns only a browser-safe delivery", async () => {
  let base;
  let received;
  await withApi(
    async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      received = JSON.parse(Buffer.concat(chunks));
      assert.equal(request.headers.authorization, "Bearer test-only-key");
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ status: "delivered", delivery: delivery(base) }));
    },
    async (url) => {
      base = url;
      const client = createClient({ endpoint: base, apiKey: "test-only-key" });
      const result = await client.requestAd(input);
      assert.equal(result.id, "delivery-1");
      assert.deepEqual(received, input);
      assert.ok(result.ttl_ms <= 60_000);
      assert.ok(!JSON.stringify(result).includes("test-only-key"));
    },
  );
});

test("no fill and expired responses return no ad without an error", async () => {
  for (const status of ["no_fill", "expired"]) {
    await withApi(
      (_request, response) => response.end(JSON.stringify({ status })),
      async (url) => {
        const errors = [];
        const client = createClient({
          endpoint: url,
          apiKey: "test-only-key",
          onError: (e) => errors.push(e),
        });
        assert.equal(await client.requestAd(input), null);
        assert.deepEqual(errors, []);
      },
    );
  }
});

test("timeouts and HTTP failures fail open with redacted diagnostics", async () => {
  await withApi(
    () => {},
    async (url) => {
      const errors = [];
      const client = createClient({
        endpoint: url,
        apiKey: "test-only-key",
        timeoutMs: 20,
        onError: (e) => errors.push(e),
      });
      assert.equal(await client.requestAd(input), null);
      assert.deepEqual(errors, [{ code: "timeout" }]);
    },
  );
  await withApi(
    (_request, response) => {
      response.writeHead(500);
      response.end("do not expose provider response bodies");
    },
    async (url) => {
      const errors = [];
      const client = createClient({
        endpoint: url,
        apiKey: "test-only-key",
        onError: (e) => errors.push(e),
      });
      assert.equal(await client.requestAd(input), null);
      assert.deepEqual(errors, [{ code: "http", status: 500 }]);
    },
  );
});

test("redirects cannot forward credentials to another endpoint", async () => {
  let redirected = false;
  await withApi(
    (_request, response) => {
      redirected = true;
      response.end("unexpected");
    },
    async (target) => {
      await withApi(
        (_request, response) => {
          response.writeHead(307, { Location: target });
          response.end();
        },
        async (url) => {
          assert.equal(
            await createClient({ endpoint: url, apiKey: "test-only-key" }).requestAd(input),
            null,
          );
        },
      );
    },
  );
  assert.equal(redirected, false);
});

test("malformed deliveries and foreign measurement URLs fail closed", async () => {
  for (const body of ["not json", JSON.stringify({ status: "delivered", delivery: {} })]) {
    await withApi(
      (_request, response) => response.end(body),
      async (url) => {
        assert.equal(
          await createClient({ endpoint: url, apiKey: "test-only-key" }).requestAd(input),
          null,
        );
      },
    );
  }
  await withApi(
    (_request, response) => {
      const ad = delivery("https://different.example");
      response.end(JSON.stringify({ status: "delivered", delivery: ad }));
    },
    async (url) => {
      assert.equal(
        await createClient({ endpoint: url, apiKey: "test-only-key" }).requestAd(input),
        null,
      );
    },
  );
});

test("a delivery for a different answer is never returned to the publisher", async () => {
  let base;
  await withApi(
    (_request, response) => {
      const ad = delivery(base);
      ad.answer_id = "another-answer";
      response.end(JSON.stringify({ status: "delivered", delivery: ad }));
    },
    async (url) => {
      base = url;
      assert.equal(
        await createClient({ endpoint: url, apiKey: "test-only-key" }).requestAd(input),
        null,
      );
    },
  );
});

test("caller cancellation stops the request without exposing diagnostic callback errors", async () => {
  await withApi(
    () => {},
    async (url) => {
      const abort = new AbortController();
      abort.abort();
      const errors = [];
      const client = createClient({
        endpoint: url,
        apiKey: "test-only-key",
        onError: (error) => {
          errors.push(error);
          throw new Error("Host logger failed");
        },
      });
      assert.equal(await client.requestAd(input, abort.signal), null);
      assert.deepEqual(errors, [{ code: "aborted" }]);
    },
  );
});
