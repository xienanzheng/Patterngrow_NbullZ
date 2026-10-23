# PatternGrow market research review

Reviewed against the repository and official provider documentation on **October 22, 2026**; terminal workspace progress updated **October 23, 2026**. This roadmap concerns educational, descriptive market research. It does not call for order execution, brokerage access or personalized investment recommendations.

## Assessment

PatternGrow already has broad coverage: chart overlays, volume bars, a fundamentals panel, watchlists, research screening, forecast evaluation and an assistant. The largest opportunity is trust in the data and clarity of the calculations. More indicators will not compensate for uncertain timestamps, provider fallback behavior or missing financial statements.

The recommended product center is a research workspace with visible provenance, a volume and liquidity summary, historical risk, and source-backed company information. The current improvement pass adds a descriptive research layer and a local MCP surface; the milestones below describe the remaining work rather than claiming it is complete.

## Delivered in this pass

- Public `/research` workspace, responsive price and volume charts, historical-risk and data-quality panels, fundamentals completeness banner, and sanitized CSV export.
- Prior-20-bar volume comparisons, OBV change, approximate turnover, return windows, daily annualized volatility, ATR and sample drawdown with explicit definitions and missing-data rules.
- Selectable Yahoo/Twelve Data primary source, independent fallbacks, corrected UTC/session-date handling, source/currency metadata, and guarded 52-week fallback ranges.
- Canonical chart rows, bounded 60-second research caching, request deduplication, input validation, and unavailable states instead of silent synthetic prices.
- A tested local stdio MCP server with three read-only tools; public research startup without Supabase and fail-closed private routes.
- Admin-only shared metadata writes and bounded, descriptive assistant summaries with sanitized provider failures.
- Compatible dependency security updates and migration from the old backend test/watch tooling to Vitest 5 and Node's built-in watcher. Use Node 24 LTS. Backend audit and frontend production dependency audit are clean; seven frontend development/build-tool advisories remain in the Tailwind 3/braces/PostCSS tree. A Tailwind 4 migration is separate work and was not applied automatically.

### Terminal workspace follow-up

- Fixed-universe market context: six ETF proxies spanning US equities, long-duration US Treasuries, gold and oil futures exposure, with daily price changes, relative volume, session dates and per-row availability. USO is a futures fund, not spot oil. These rows are not a market-breadth measure or a recommendation list.
- Benchmark research: common-session indexed prices, price-return differences in percentage points, Pearson daily-return correlation, historical beta, annualized tracking error and uninterrupted rolling 20-pair correlation. Missing or unmatched observations break daily return pairs; unknown exchange timezones are excluded from timestamp alignment. Native-currency comparisons never imply currency conversion.
- Research workflow: saved browser-local navigation presets, shareable symbol/benchmark/range/view URLs, keyboard search, and versioned JSON exports containing the observations, metadata and definitions used by the view.
- MCP now includes bounded `get_market_comparison` and `get_market_overview`; historical tools reuse the same cache as the API rather than introducing another provider-fetch path.

The SEC and FRED adapters, corporate-action normalization, exchange calendars, durable cache and same-time intraday relative volume remain future work below. Paid-provider credentials, entitlements and redistribution rights have not been verified. This is progress toward a professional research workflow, not equivalence to a licensed institutional terminal.

## Prioritized implementation

| Priority | Work | Acceptance criteria |
| --- | --- | --- |
| P0 | Provider integrity | Every response states provider, fetched time, data-as-of time, exchange timezone, currency, delay, adjustment basis and session completeness. Unknown properties are explicitly unknown. Fallbacks preserve provenance and never introduce synthetic data silently. |
| P0 | Canonical candles | Sort and deduplicate timestamps; validate OHLC ordering and nonnegative volume; retain missingness. Compare price and volume only across matching sessions and adjustment bases. Use exchange calendars for holidays and daylight-saving transitions. |
| P0 | Operational safety | Restrict shared metadata writes to an explicit admin role; sanitize upstream errors; bound AI requests and responses; review runtime dependency advisories and deployment proxy trust. |
| P1 | Volume research | Display latest volume, prior-20-session mean, relative volume, approximate close-times-volume turnover, OBV, MFI, and data-quality limitations. Exclude the current session from the comparison baseline. |
| P1 | Historical risk | Display realized volatility, ATR, drawdown over the selected sample and historical returns. Require sufficient observations; distinguish annualized daily statistics from intraday values. |
| P1 | Durable provider cache | Cache by symbol/exchange/interval/session/adjustment/provider. Deduplicate simultaneous requests, enforce provider-wide quotas, retry only transient failures with backoff, and return stale data only with an explicit stale flag. |
| P2 | Company facts with evidence | Add SEC facts and filing links; show unit, period end, filed date, form and accession. Distinguish quarter-to-date, year-to-date and annual periods; preserve restatements and original vintages. |
| P2 | Macro and event context | Add a small FRED series set and release dates with source, units and vintage. Add earnings/dividend/split events from a licensed feed with clear event-time precision. |
| P2 · delivered | Comparative research | Common-session benchmark charts, daily relationships, rolling correlations and sample counts; calendar verification and action-adjusted total returns remain open. |
| P3 · initial delivery | Research reproducibility | Versioned research/comparison snapshot exports include data, definitions, as-of times and limitations. Cross-device snapshot storage and historical methodology migrations remain open. |

Intraday relative volume must compare accumulated volume at the same exchange-local time across prior sessions. A partial day's volume divided by full-day historical means is a different measure and must be labeled accordingly. True session VWAP requires qualifying intraday observations; typical-price-weighted daily bars are an approximation, not execution-level VWAP. A volume profile needs intrabar trade or appropriately granular data and should not be inferred precisely from daily OHLCV.

## Repository findings to resolve

These observations describe the reviewed baseline; consult the current diff and tests for fixes made in this improvement pass.

- `backend/utils/marketData.js` originally chained Yahoo to an undocumented Google `getprices` endpoint and then Twelve Data. An exception in the Google fetch could prevent Twelve Data from being attempted. Provider changes need independent failure handling and visible source labels.
- Twelve Data's original requested row count depended only on the range, not the interval. Its exchange-local datetime strings were parsed using the execution host's timezone. `Number(null)` and `Number('')` also risked changing missing volume into zero.
- Chart-derived fundamentals assumed USD and could label a high/low over a shorter fallback sample as a 52-week range. These fields require verified currency and sufficient coverage.
- Metadata mutation routes used ordinary authentication before service-role writes into shared data. Authentication alone does not establish permission to edit global reference data.
- Several API catch paths returned upstream error messages verbatim. The assistant proxy lacked a fetch deadline and a firm output budget; the original prompt requested decisive positional labels even when supporting fields were missing. Descriptive summaries should cite available evidence and explain missing inputs.
- Forecast uncertainty labels differed between parts of the UI. Historical estimates need one shared definition, a stated horizon and out-of-sample calibration evidence. A model interval is not a guaranteed range.
- The dependency audit identified runtime issues in the Express/proxy/query-parser/WebSocket dependency trees, plus separate development-tool issues in Vitest/Vite/Tinypool and file watchers. Recheck `npm audit --omit=dev` after compatible upgrades. Development-server advisories are not proof of production exploitability, and an audit suggestion to downgrade Nodemon should not be applied blindly.

### Shared metadata administration

The manual and CSV metadata-write routes now require verified authentication followed by explicit administrator authorization. The server accepts either a trusted Supabase `app_metadata.role` equal to `admin`, or a user ID listed in the backend environment variable `METADATA_ADMIN_USER_IDS` (comma-separated IDs). With neither grant, writes return 403. User-editable `user_metadata` never grants access. Configure administrators only through trusted server-side administration; do not expose this setting in the browser. Reads remain available under their existing rules.

## Data-source choices

The recommendation is an architectural choice: use one documented OHLCV provider with explicit coverage, SEC for filed facts, and FRED for macroeconomic context. Keep each adapter replaceable. Do not make access to an undocumented fallback the product's reliability foundation.

| Source | Strongest role | Verified access and limitations |
| --- | --- | --- |
| **Massive, formerly Polygon** | US-equity historical candles and corporate actions | Basic is $0, 5 requests/minute, two years of history and end-of-day access. Starter is $29/month with five years and 15-minute delay; Developer is $79/month with ten years and delay; Advanced is $199/month with real-time access. These listed tiers are individual-use plans, not permission for public redistribution. [Official pricing](https://massive.com/pricing?product=stocks). |
| **Twelve Data** | Broader international coverage and a practical second history adapter | Basic lists 8 API credits/minute and 800/day. Requests consume endpoint-specific credits. The individual pricing page offers several paid credit configurations, so compare the selected credit tier and exchange coverage instead of treating the largest displayed price as the entry price. Individual plans specify personal/internal/non-commercial use. [Official pricing](https://twelvedata.com/pricing). |
| **SEC EDGAR** | Filed US company fundamentals and filing history | Public APIs need no key. Company Facts exposes reported XBRL facts; custom tags and company-specific reporting contexts still require care. This is a financial-statement source, not a price feed. [SEC API documentation](https://www.sec.gov/search-filings/edgar-application-programming-interfaces). |
| **FRED / ALFRED** | Rates, inflation, employment and economic context | Series-level and bulk-release APIs are documented. Keep units, release timing and revision vintages with observations. Availability via FRED does not override third-party rights. [FRED API](https://fred.stlouisfed.org/docs/api/fred/), [terms](https://fred.stlouisfed.org/docs/api/terms_of_use.html). |
| **Alpha Vantage** | Select supplemental datasets, including existing news integration | Standard free allowance is 25 API requests/day. The support page mentions separate verified educational/open-source access. Real-time and 15-minute delayed US data require premium entitlement; the standard free allowance is too small for repeated multi-symbol refreshes. [Official support](https://www.alphavantage.co/support/). |

Prices are USD monthly figures where stated, checked on the review date. No subscriptions or accounts were created. Provider selection still needs a representative data-quality trial and confirmation of permitted display, caching, export and redistribution for the app's intended audience.

### Adapter specifics

**Massive:** adopt `api.massive.com` for new work while retaining an explicit migration path for the existing `POLYGON_API_KEY` configuration. The provider announced the rebrand and parallel endpoint support in 2025; avoid assuming legacy support is permanent. [Rebrand announcement](https://massive.com/blog/polygon-is-now-massive). Aggregate bars are built from qualifying trades; an empty interval can mean no qualifying activity. The `adjusted` option is split adjustment, not proof of dividend-adjusted total return. Preserve provider VWAP and trade count when available, and retain the adjustment flag. [Aggregate-bar specification](https://massive.com/docs/rest/stocks/aggregates/custom-bars).

**Twelve Data:** request exact date bounds, calculate required rows for the interval, and handle the 5,000-observation limit explicitly. [Historical-data guidance](https://support.twelvedata.com/en/articles/5214728-getting-historical-data). For intraday timestamps request UTC; daily/weekly/monthly timestamps represent exchange-local dates even when a timezone parameter is supplied. Keep a session-date field separate from a UTC instant. [Official client/API documentation](https://github.com/twelvedata/twelvedata-java/blob/main/docs/MarketDataApi.md).

**SEC:** fetch from the backend with an identifying User-Agent, cache results, and remain below the published aggregate ceiling of ten requests/second. Use nightly bulk data for broad ingestion. Preserve filing dates so a historical study cannot accidentally use subsequently restated facts. [Developer resources](https://www.sec.gov/about/developer-resources), [API documentation](https://www.sec.gov/search-filings/edgar-application-programming-interfaces).

**FRED:** a backdated observation is not automatically information available at that historical time. ALFRED's real-time-period parameters select the vintage known during a specified period and avoid silently importing later revisions. [Vintage semantics](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html).

## MCP architecture

```text
Market providers → normalized adapters → cache + quality checks
                                      → descriptive calculations
                                         ↙                  ↘
                                   REST / UI             local MCP
```

The implementation is in [`backend/mcp`](../backend/mcp/README.md). It uses the official MCP TypeScript SDK v2 and provides five read-only tools: `get_market_history`, `get_market_research`, `get_market_comparison`, `get_market_overview`, and `get_provider_status`. Daily history is bounded to two years and 520 rows; tool inputs cannot choose an arbitrary URL or query. Source labels, missingness and limitations accompany observations. Provider configuration is separate from verified health and entitlement. [SDK documentation](https://ts.sdk.modelcontextprotocol.io/v2/).

Keep analytics in ordinary service functions shared with the UI. MCP is an access layer; it should not implement a second version of indicators or bypass provider budgets. The local server does not expose account, portfolio, execution or write tools. It does not open a network listener or change a global client configuration.

The next useful tools are bounded `get_company_facts` and `get_macro_series` after their adapters exist. Both should return citations, units and as-of metadata rather than long raw documents. Provider-hosted MCP can be evaluated separately: Alpha Vantage documents an official MCP endpoint, but it still depends on data entitlements and does not replace app-owned normalization or caching. [Official Alpha Vantage MCP](https://mcp.alphavantage.co/).

## Definition of ready

Before presenting this as a dependable research product, test normal sessions, shortened sessions, splits, missing volume, delayed feeds, exhausted quotas and provider outages. Confirm matching definitions across UI, REST and MCP. Review a sample of fundamentals against filed statements and compare candles against the selected provider's reference output. Paid-feed quality and redistribution rights remain unverified until a provider-specific trial and entitlement review are performed.
