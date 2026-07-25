---
target: frontend/src/components/Dashboard.jsx
total_score: 18
p0_count: 2
p1_count: 2
timestamp: 2026-07-25T00-54-58Z
slug: frontend-src-components-dashboard-jsx
---
Method: dual-agent (A: design-review · B: detect.mjs CLI scan)

## Design Health Score: 18/40 — Poor

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Inline text-only loading; no skeletons; multiple requests fire silently |
| 2 | Match System / Real World | 2 | "Mini NZ Assistant", "Prototype score", env-var config in news empty state |
| 3 | User Control and Freedom | 1 | No cancel, no undo, 3 buttons → 1 function, no clear-all-filters |
| 4 | Consistency and Standards | 2 | 3 CTAs, same outcome, 3 different colors; duplicate Prev/Next + Load More |
| 5 | Error Prevention | 2 | `initialCapital` accepts negatives, no CSV confirm, no Add Ticker debounce |
| 6 | Recognition Rather Than Recall | 2 | ADX/DI values with no tooltip; Snapshot label changes by active indicator |
| 7 | Flexibility and Efficiency | 1 | No keyboard shortcuts; no bulk table ops; range is dropdown not pill group |
| 8 | Aesthetic and Minimalist Design | 2 | Uppercase eyebrow on every label; 5 chart colors competing; hardcoded subtitle |
| 9 | Error Recovery | 2 | Raw error strings; amber for both success and error; no retry button |
| 10 | Help and Documentation | 1 | No tooltips; no contextual help; dev-note copy in UI |
| **Total** | | **18/40** | **Poor — significant improvements needed** |

## Anti-Patterns Verdict

LLM: `text-xs uppercase tracking-wide text-zinc-400` appears ~25 times — every stat label, every filter, "Upload CSV (header: symbol,name,sector,region,ipo_year)." This is the #1 AI-slop tell. Otherwise: no gradient text, no glassmorphism, no numbered scaffolding, no hero-metric template. The forecast cone is genuinely distinctive.

Detector (4 findings): All contrast warnings — gray text on colored backgrounds:
- `text-zinc-400` on `bg-amber-400` (Dashboard.jsx:493) — real issue
- `text-zinc-300` on `bg-amber-400` (Dashboard.jsx:546) — real issue  
- `text-zinc-100` on `bg-amber-400` (Dashboard.jsx:546) — borderline
- `text-zinc-300` on `bg-red-500` (RegimePanel.jsx:20) — real issue

## Priority Issues

**[P0] Three buttons, one function, zero feedback.** "Backtest Signals" (emerald), "Run Simulation" (amber), "Generate 60-day Forecast" (ghost amber) all call `loadInsights()` with no arguments. Three visual weights imply three different behaviors that don't exist. Users re-click and double-fire requests silently. Fix: merge to one "Analyze" button, or split backend endpoints and wire each button to its own route. Add per-button loading state + disable during call.

**[P0] Symbol input fires API on every keystroke.** `onChange` sets `symbol` on each character; the `useEffect` on `symbol` fires `loadInsights()` immediately. Typing "TSLA" fires 4 requests. The `cancelRef` handles race conditions but network churn is real. Fix: 400ms debounce or submit-on-Enter.

**[P1] News empty state exposes `.env` config instructions.** "Configure `ALPHA_VANTAGE_KEY` for the backend or `VITE_ALPHA_VANTAGE_KEY` for the client proxy to activate feed ingestion." External users don't operate backends. Fix: "News is unavailable for this symbol" or hide the section when not configured.

**[P1] Uppercase eyebrow on every label erases hierarchy.** `text-xs uppercase tracking-wide` on every label from "Last Price" to "Upload CSV header format." Nothing can stand out. Reserve this pattern for 3–5 navigation-level labels. Use `text-xs text-zinc-500` for supporting metadata and `text-sm text-zinc-300` for data labels.

**[P2] Duplicate pagination: Prev/Next AND Load more.** Both increment `metadataPage` identically. Remove "Load more" or rewrite to genuine infinite-scroll.

**[P3] Success and error messages identical in color.** `metadataActionStatus` renders as `text-amber-200` for both "Saved AAPL." and "Symbol is required." Fix: `text-emerald-300` for success, `text-red-300` for errors.

## Persona Red Flags

Alex (power): No keyboard shortcut to submit ticker; range picker is a dropdown not pill-tabs; no bulk ops on metadata table; sidebar has no collapse.

Sam (a11y): Active tab indicator is `bg-amber-400/15` — ~1.5:1 contrast, invisible to low-vision users; metadata `<tr onClick>` rows have no `tabIndex` or `role="button"`; uppercase labels at 10–11px may fail 4.5:1; no `aria-label` on icon-less buttons.

Riley (stress): Negative `initialCapital` bypasses HTML `min` validation (no `<form>` wrapper); Add Ticker button not disabled during flight → 10 rapid clicks fire 10 requests; no CSV size cap.

## Minor Observations
- Header subtitle hardcodes "AAPL, TSLA" — wrong for any other loaded symbol
- Footer is a commit message: replace with "Prices delayed 15 min. Not financial advice."
- "Mini NZ Assistant" tab → "AI Assistant"
- `shadow-inner` on non-interactive sidebar cards (decorative, no purpose)
- RegimePanel renders blank chips when ADX data is absent — should not render at all
- `rounded-2xl` on every card reads overstyled for data density; `rounded-lg` is the Bloomberg/Refinitiv convention
- Faceted Retrieval Examples panel has hardcoded dev-note strings as UI content

## Questions
1. Is this a charting tool with analysis tabs, or an analysis platform that happens to show a chart? The answer determines whether the symbol/chart should be a persistent canvas or one tab of several.
2. CSV upload and Add Ticker are exposed to all authenticated users — is this intended, or should non-admin users see read-only metadata?
3. Should the sidebar persist across tab switches as a global control surface, or should each tab own its controls?
