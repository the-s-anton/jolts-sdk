# Jolts publisher SDK and setup agent

Connect an AI application to Jolts without putting API credentials in a chat or
browser. These packages currently support **test ads**, not live auctions or
publisher payouts.

| Package | Runs in | Responsibility |
| --- | --- | --- |
| [@jolts/sdk](packages/sdk/README.md) | Your backend and browser | Request, display and measure ads without delaying the AI answer |
| [@jolts/agent](packages/agent/README.md) | Your local coding-agent environment | Browser-approved setup and automatic server credential installation |

The SDK has no runtime dependencies. The MCP agent is development tooling and
does not belong in your application's runtime bundle. Both require Node 22 or
newer for their server tooling.

## Connect your application

1. Create your app in the Jolts dashboard and open **Setup**.
2. Give its generated instructions to your coding agent. The instructions include
   the app-specific authorization URL and pinned package versions.
3. Approve the connection in your browser. The MCP agent installs the credential
   in your project's ignored, untracked `.env.local`; do not copy or read it into
   the conversation.
4. Your coding agent installs the SDK, adds a backend endpoint and mounts the
   sponsored card after the AI answer.
5. Verify a test ad in your app and check its status in the Jolts dashboard.

Use the generated authorization URL unchanged. Do not invent an API URL or put
server credentials in frontend code. The SDK does not intercept chats, infer
consent or collect unrelated messages.

## Build and test

```sh
npm ci
bin/format
bin/ci
```

CI runs on Node 22 and 24. It compiles strict TypeScript, tests request failures,
cancellation, validation, credential installation and replacement, and installs
packed artifacts in isolated projects. Public CI uses synthetic data and requires
no API credentials or private repository access.

The complete browser-approved integration is additionally exercised against the
private platform using the public npm packages. Public unit/packaging tests do
not substitute for that server integration test.

## Examples and reference

- [Local publisher example](packages/sdk/examples/README.md)
- [SDK server, browser and custom renderer API](packages/sdk/README.md)
- [MCP setup and connection replacement](packages/agent/README.md)
- [Architecture and request lifecycle](docs/architecture.md)
- [Contributing](CONTRIBUTING.md)
- [Release procedure](docs/releasing.md)
- [Security reporting](SECURITY.md)

This repository is the source of truth for both packages. The Rails platform is
private and is not included in this repository or its Git history. The existing
npm 0.1.0 releases predate this source extraction; subsequent releases will include
this repository's metadata. Published npm versions are immutable.

## License

MIT. See [LICENSE](LICENSE).
