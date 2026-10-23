# PatternGrow historical research MCP

This local, read-only server exposes the same market-history adapters and descriptive research calculations as the app. It does not load the Express server, Supabase, user accounts, broker routes or assistant chat proxy.

## Run

Use Node.js 24 LTS (or the Node versions supported by `backend/package.json`). From `backend`, run:

```sh
npm ci
npm run mcp
```

The process waits for an MCP client over stdio. Standard output contains protocol messages only. Optional provider configuration is loaded from `backend/.env`, resolved relative to the server file; existing process environment takes precedence. No keys are returned by any tool. Never put secrets in committed client configuration.

For an MCP host that accepts a `mcpServers` JSON object, adapt the absolute path in this example:

```json
{
  "mcpServers": {
    "patterngrow-research": {
      "command": "node",
      "args": ["/absolute/path/to/Patterngrow_NbullZ/backend/mcp/server.js"]
    }
  }
}
```

The direct `node` command avoids package-manager banners on protocol stdout. This is an example, not an automatically installed connection. No global MCP configuration has been changed.

## Tools

| Tool | Inputs | Returns |
| --- | --- | --- |
| `get_market_history` | One ticker; range `1mo`, `3mo`, `6mo`, `1y`, or `2y`; limit 1–520, default 250 | Daily OHLCV observations, sources, truncation flag and limitations |
| `get_market_research` | One ticker and the same range choices | Descriptive volume, risk and quality statistics from at most 520 daily observations |
| `get_provider_status` | None | Configuration flags and coverage notes; not a live health or entitlement check |

All tools are marked read-only. No tool accepts a URL, filesystem path, SQL, credentials or arbitrary request payload. The SDK validates strict input schemas. The server limits incoming messages to 64 KB and each serialized tool payload to 256 KB. It allows at most two outstanding provider fetches and stops waiting after 26 seconds. Existing market adapters enforce their own per-fetch abort deadlines; an outstanding fetch retains its concurrency slot until it settles. Provider errors are replaced with generic errors so request URLs and secrets cannot leak through an error message.

Daily bars can contain an incomplete latest session. Provider-supplied currency, exchange timezone, date precision, truncation and completion flags are preserved when safely formatted. Adjustment basis, currency, venue coverage and delay are not independently verified by these tools. Missing data remains null, and synthetic data is rejected. The transport is local stdio, with no HTTP listener. The official SDK handles MCP negotiation and transport rather than a custom JSON-RPC implementation.

## Verification

```sh
npm test -- tests/mcpResearch.test.js
```

The tests use deterministic observations and the SDK's in-memory transport. They cover initialization, discovery, calls, strict validation, error redaction, output bounds, timeout behavior and the absence of write tools. They do not verify paid-provider credentials, licensing or market-data accuracy.

## Future expansion

Keep the app's provider and analytics services as the source of truth. Add bounded tools for SEC filing facts and FRED observations only after their normalized adapters, provenance and caching are tested. A future remote MCP service needs its own authentication, per-user quotas and deployment review; this local server must not be exposed by adding an unauthenticated HTTP wrapper.

SDK reference: [official TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/).
