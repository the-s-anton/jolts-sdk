import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAd } from "../dist/browser.js";

async function withBrowserFetch(fetch, run) {
  const originalFetch = globalThis.fetch;
  globalThis.location = new URL("https://publisher.example");
  globalThis.fetch = fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.location;
  }
}

test("browser distinguishes a network failure from an invalid delivery", async () => {
  await withBrowserFetch(
    async () => {
      throw new TypeError("Network unavailable");
    },
    async () => {
      const errors = [];
      assert.equal(await loadAd("/sponsored", { onError: (e) => errors.push(e) }), null);
      assert.deepEqual(errors, [{ code: "network" }]);
    },
  );
});

test("browser reports caller cancellation without starting a request", async () => {
  let requests = 0;
  await withBrowserFetch(
    async () => {
      requests++;
      throw new Error("Cancelled request must not be sent");
    },
    async () => {
      const controller = new AbortController();
      controller.abort();
      const errors = [];
      assert.equal(
        await loadAd("/sponsored", {
          request: { signal: controller.signal },
          onError: (e) => errors.push(e),
        }),
        null,
      );
      assert.deepEqual(errors, [{ code: "aborted" }]);
      assert.equal(requests, 0);
    },
  );
});
