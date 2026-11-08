# Release procedure

Release SDK and agent packages independently when only one changes. Keep the
dashboard's installed versions explicit. A public package does not deploy the
private platform or enable live ads.

1. Update the changed package version, README examples and lockfile. Existing
   npm 0.1.0 versions are immutable; do not republish them from this repository.
2. Run `bin/format` and `bin/ci`. Review the diff and archive contents.
3. Push the candidate and wait for the GitHub Node 22 and Node 24 checks.
4. Pack the candidate:

   ```sh
   mkdir -p tmp/release
   npm pack ./packages/sdk --pack-destination tmp/release
   npm pack ./packages/agent --pack-destination tmp/release
   ```

   Prepack compiles each package. Archives may contain only compiled code,
   declarations, README, manifest and license. Never publish the repository root.
5. Authenticate as an authorized npm maintainer with 2FA and publish the reviewed
   archive using `npm publish <archive> --access public`. Complete any npm
   verification in the browser. Never place publishing tokens or OTPs in source.
6. Wait until the public registry serves the version. Verify its integrity matches
   the reviewed archive and install it in an independent project.
7. In the private platform checkout, run its publisher-agent browser regression
   against the exact published versions. Verify browser approval, automatic
   credential installation, replacement, test-card delivery and dashboard receipts.
   Do not copy an API key manually.
8. Update the private application's package pins and snapshot through a reviewed
   change. Deploy separately only when authorized.

Public CI packs both packages and tests isolated installation, but it deliberately
has no npm publishing secrets. Publishing is an explicit maintainer operation.
A successful dry run is not a published release.
