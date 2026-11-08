# Contributing

Use Node 22 or newer. Run `npm ci`, then `bin/ci`. Apply formatting with
`bin/format`. Changes to behavior need a focused regression test that fails
before the fix and passes afterward.

Keep server credentials out of browser code and MCP output. Validate external
responses at the protocol boundary. Preserve fail-open ad behavior, cancellation,
expiry handling and observer cleanup. Keep the SDK free of runtime dependencies.

Use synthetic examples only. Do not commit environment files, tokens, publisher
conversations, personal data, build output or private platform source.

For a pull request, describe the user-visible change and the checks you ran.
Public CI covers package contracts; changes to the platform protocol additionally
need the private platform's end-to-end test before release.

Published versions cannot be overwritten. See [releasing](docs/releasing.md).
