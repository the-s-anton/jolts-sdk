// A separate publisher process for local integration testing; all content is synthetic.

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createClient } from "../dist/server.js";

const client = createClient({
  endpoint: process.env.JOLTS_ENDPOINT,
  apiKey: process.env.JOLTS_API_KEY,
  onError: ({ code, status }) => console.error(JSON.stringify({ code, status })),
});
let origin;
const paths = {
  ad: "/sponsored",
  browser: "/browser.js",
  protocol: "/protocol.js",
  client: "/client.js",
};
const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  const url = new URL(request.url, origin);
  try {
    if (url.pathname === paths.ad) {
      const answerId = url.searchParams.get("answer");
      const ad = await client.requestAd({
        opportunity_id: answerId,
        answer_id: answerId,
        completed_at: new Date().toISOString(),
        origin,
        context: { messages: [{ role: "user", content: "Compare trail running shoes" }] },
        privacy: { contextual_ads: true, measurement: true },
        device: { ip: request.socket.remoteAddress, user_agent: request.headers["user-agent"] },
      });
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(ad));
    } else if ([paths.browser, paths.protocol].includes(url.pathname)) {
      response.setHeader("Content-Type", "text/javascript");
      const file = url.pathname === paths.browser ? "browser.js" : "protocol.js";
      response.end(await readFile(new URL(`../dist/${file}`, import.meta.url)));
    } else if (url.pathname === paths.client) {
      response.setHeader("Content-Type", "text/javascript");
      response.end(`
        import { loadAd, renderAd } from ${JSON.stringify(paths.browser)};
        const container = document.querySelector("#slot");
        const status = document.querySelector("#status");
        const url = new URL(${JSON.stringify(paths.ad)}, location.origin);
        url.searchParams.set("answer", crypto.randomUUID());
        const ad = await loadAd(url.href);
        const options = { onError: e => { status.textContent = e.code; } };
        let dispose = renderAd(container, ad, options);
        document.querySelector("#show").onclick = () => { container.hidden = false; };
        document.querySelector("#hide").onclick = () => { container.hidden = true; };
        document.querySelector("#remount").onclick = () => { dispose = renderAd(container, ad, options); };
        document.querySelector("#dispose").onclick = () => { dispose(); };
        status.textContent = ad ? "Ready" : "No ad";
      `);
    } else if (url.pathname === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(`<!doctype html><html lang="en"><head>
        <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Publisher SDK example</title></head><body><main>
        <h1>A publisher's answer</h1><p>Compare grip, fit and drainage when choosing trail shoes.</p>
        <p id="status" role="status">Loading</p>
        <button id="show">Show card</button><button id="hide">Hide card</button>
        <button id="remount">Remount card</button><button id="dispose">Remove card</button>
        <section id="slot" hidden></section></main>
        <script type="module" src="${paths.client}"></script></body></html>`);
    } else {
      response.writeHead(404);
      response.end();
    }
  } catch {
    response.writeHead(500);
    response.end("Example unavailable");
  }
});
server.listen(Number(process.env.PUBLISHER_PORT ?? 0), "127.0.0.1", () => {
  origin = `http://127.0.0.1:${server.address().port}`;
  console.log(JSON.stringify({ url: origin }));
});
