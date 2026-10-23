# PatternGrow historical research MCP

This local, read-only server exposes the app's historical research, comparison and market overview services. It does not load the Express server, Supabase, user accounts, broker routes or assistant chat proxy.

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
| `get_market_comparison` | One ticker, one benchmark (default `SPY`) and the same range choices | Common-session indexed prices, historical relative returns, correlation, beta, tracking error and sample limitations; at most 520 aligned daily rows with missing values preserved |
| `get_market_overview` | None | A daily three-month cross-section of six fixed proxies (`SPY`, `QQQ`, `IWM`, `TLT`, `GLD`, `USO`), coverage, session dates and at most 20 sparkline points per row |
| `get_provider_status` | None | Configuration flags and coverage notes; not a live health or entitlement check |

All tools are marked read-only. No tool accepts a URL, filesystem path, SQL, credentials or arbitrary request payload. Overview accepts no custom symbol list, and comparison accepts exactly one symbol and one benchmark. The SDK validates strict input schemas. The server limits incoming messages to 64 KB and each serialized tool payload to 256 KB. It allows at most two outstanding market-data tool operations and stops waiting after 26 seconds. The underlying comparison and overview services have their own bounded fan-out: two histories per comparison and at most three simultaneous history requests for the fixed six-row overview. Existing market adapters enforce per-fetch abort deadlines; an operation retains its concurrency slot until its underlying work settles. Provider errors are replaced with generic errors so request URLs and secrets cannot leak through an error message.

History and research use `getResearchSnapshot`, sharing its 60-second cache and simultaneous-request deduplication with comparison and overview within the MCP process. The overview also caches its bounded summary for 60 seconds, including unavailable rows. Separately running API and MCP processes have separate in-memory caches. Research preserves the service's quality findings and calculation metadata; when a service returns more than 520 daily bars, MCP recomputes the summary on its bounded sample and reports truncation. Comparison rejects an oversized series instead of displaying fewer rows than its summary describes.

Daily bars can contain an incomplete latest session. Provider-supplied currency, exchange timezone, date precision, truncation and completion flags are preserved when safely formatted. Adjustment basis, currency, venue coverage and delay are not independently verified by these tools. Missing data remains null, and synthetic data is rejected. The transport is local stdio, with no HTTP listener. The official SDK handles MCP negotiation and transport rather than a custom JSON-RPC implementation.

The overview is a limited fund-proxy cross-section, not market breadth or live quotes. Proxy prices differ from index levels, spot commodities and bond yields; USO is an oil futures fund proxy. Missing closes and unavailable rows remain visible, and coverage identifies unsynchronized or unverified session dates.

## Verification

```sh
npm test -- tests/mcpResearch.test.js tests/mcpStdio.test.js
```

The tests use deterministic observations and the SDK's in-memory transport. They cover five-tool discovery and calls, strict validation, error redaction, output bounds, cross-tool concurrency and timeout behavior, preserved missingness, and real research-service cache coalescing with a mocked provider. A subprocess test starts the actual stdio entry from another working directory and exercises the real comparison, research and overview services against a mocked network response without account configuration. They do not verify paid-provider credentials, licensing or market-data accuracy.

## Future expansion

Keep the app's provider and analytics services as the source of truth. Add bounded tools for SEC filing facts and FRED observations only after their normalized adapters, provenance and caching are tested. A future remote MCP service needs its own authentication, per-user quotas and deployment review; this local server must not be exposed by adding an unauthenticated HTTP wrapper.

SDK reference: [official TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/).
