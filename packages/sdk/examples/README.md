# Local publisher example

This small Node server displays a synthetic AI answer, then loads a test card
independently. It is a local integration fixture, not a production authentication
or consent implementation.

## Run

1. From the public repository root, run `npm ci && npm run build`.
2. In your Jolts workspace, create or select an app and allow the origin
   `http://127.0.0.1:4100` in its settings.
3. Follow the app's Setup prompt. Configure the MCP agent with this repository's
   absolute path as its project directory and the generated authorization URL.
   Approve in the browser and call `finish_publisher_setup`. This installs
   `.env.local` automatically. Never paste its contents into a chat.
4. From the repository root:

```sh
PUBLISHER_PORT=4100 node --env-file=.env.local --require ./packages/sdk/examples/localhost.cjs packages/sdk/examples/server.mjs
```

Open `http://127.0.0.1:4100`. Click **Show card**, keep the card visible for at
least a second, and use its link to test a real click. **Hide**, **Remount** and
**Remove** exercise lifecycle cleanup. Check the dashboard for test verification.

Stop with Ctrl+C. This stops the publisher process; it does **not** revoke an
agent-installed credential. Revoke it in the dashboard when no longer needed.

The localhost DNS adapter is only for local testing and is not shipped in the
SDK. The example only binds to loopback. It sends synthetic context and does not
enable audience insights. Do not expose it publicly or use its request fields as
a substitute for your production application's authorization and permissions.

The production integration should use `mountAd` and call its returned cleanup
when the answer component unmounts. This fixture uses `loadAd` and `renderAd`
separately so its controls can explicitly exercise remounting the same delivery.
