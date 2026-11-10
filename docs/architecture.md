# Boundaries and lifecycle

The platform decides whether to return an ad. The SDK transports the permitted
context and renders the returned delivery; it does not classify prompts,
perform auctions or establish whether traffic is human.

## Setup

A local MCP process starts authorization with an ephemeral RSA public key. The
publisher approves the selected app in the dashboard. The agent receives an
encrypted test credential, decrypts it locally and installs it into an ignored,
untracked environment file with owner-only permissions. MCP results contain
status information, not credentials. Restarting the agent before installation
requires a new authorization.

Connection replacement follows the same browser approval. The old credential's
overlap begins only after installation is acknowledged. The publisher must
restart its application to load the replacement.

## Runtime

1. The publisher finishes its AI answer.
2. Its authenticated backend requests an ad using the server SDK.
3. The browser receives only a safe delivery response or null.
4. The browser SDK renders a disclosed sponsored card and records visibility and
   trusted clicks using the supplied signed URLs.
5. Unmount cleanup cancels pending requests and disposes observers.

The answer never depends on ad availability. Requests have a bounded timeout and
do not retry automatically. Empty, failed or expired deliveries leave no card.
Only receipt transport has a bounded retry with stable identifiers.

The publisher owns authorization, truthful permissions, trusted client-IP
handling and context selection. Requests must not trust arbitrary browser claims.
Receipt acceptance is not proof of human attention or payable earnings.

## Repository ownership

Package changes happen here. The private Rails repository retains its existing
versioned package snapshot for local regression fixtures. It must not independently
develop package behavior. New releases are adopted there deliberately, with
updated version pins and a full browser-approved integration rehearsal.
