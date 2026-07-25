---
target: frontend/src/components/Dashboard.jsx
total_score: 21
p0_count: 0
p1_count: 1
timestamp: 2026-07-25T02-52-21Z
slug: frontend-src-components-dashboard-jsx
---
## Patterngrow Dashboard — Design Critique (Post-merge review)

Method: dual-agent (A: aee4f60ae63f597f7 · B: a36757d0adbcf2cb2)

### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | No skeleton states; loading collapses to dashed empty box |
| 2 | Match System / Real World | 3 | Finance terms appropriate; "Metadata Explorer" is internal jargon |
| 3 | User Control and Freedom | 2 | No undo after Apply Weights; blur fires API with no cancel |
| 4 | Consistency and Standards | 2 | Blue accent in merged components vs amber in Dashboard (now fixed) |
| 5 | Error Prevention | 2 | Weights not visually validated; CSV uploads blindly |
| 6 | Recognition Rather Than Recall | 3 | Tabs visible; ensemble weights show raw values not normalized % |
| 7 | Flexibility and Efficiency | 2 | No keyboard shortcut for Analyze; range is dropdown not segmented |
| 8 | Aesthetic and Minimalist Design | 2 | Overview tab: 11 concurrent sections, no hierarchy |
| 9 | Error Recovery | 2 | Raw API error strings surfaced; stale "Saved." messages linger |
| 10 | Help and Documentation | 1 | No tooltips, no onboarding, no contextual help |
| **Total** | | **21/40** | **Acceptable — significant improvements needed** |

### Anti-Patterns Verdict

**LLM assessment:** Partial AI-slop tells present. Hero-metric stat grid (Last Price / Market Cap / Momentum) is the template-reflex layout. Every section uses identical `rounded-2xl border border-zinc-800 bg-zinc-900/60` card formula with no weight differentiation. Multiple `uppercase tracking-wide` eyebrows across merged components (now removed). Overview tab renders 11 sections simultaneously with no progressive disclosure.

**Deterministic scan:** 9 warnings, all gray-on-color. Primary issue: `text-slate-400 on bg-blue-500` in AlertsPanel (now fixed). `text-zinc-400/zinc-200/zinc-300 on bg-amber-400` at lines 526 and 584 — these are false positives; the backgrounds are `bg-amber-400/25` and `bg-amber-400/10` (10-25% opacity), so the actual contrast is against zinc-950 base.

**Visual overlays:** Not available (no browser automation in this session).

### Overall Impression
The core design is solid — dark theme, amber accent, financial data hierarchy. The main problem was a color system split: five components from the remote branch used blue+slate while the original used amber+zinc, creating the visual inconsistency the user noticed. That is now fixed. Remaining opportunity is reducing cognitive load on the overview tab (11 sections is too many to scan) and adding progressive disclosure for advanced controls.

### What's Working
1. **Signal color system.** Emerald/red for buy/sell signals is semantically clean and distinct from the amber brand color. Used consistently throughout accountability, conviction panels, and the signal chart.
2. **Tabular nums.** `font-variant-numeric: tabular-nums` globally applied — financial numbers won't jitter as values update. Correct production decision.
3. **Reduced motion.** `prefers-reduced-motion` block in index.css is complete and correct.

### Priority Issues (remaining after this fix pass)

**[P1] Overview tab renders 11 sections simultaneously**
Why: Users cannot form a reading hierarchy when everything is equal weight and simultaneously present. New users see a wall of data.
Fix: Collapse Portfolio Simulation, Forecast Accountability, Signal Conviction, and Market Narrative behind disclosure toggles. The tab infrastructure already exists.
Command: /impeccable distill

**[P2] Chart color system ungoverned**
Why: StockChart uses 9 ad-hoc hex colors (cyan, purple, pink, orange, green) with no palette logic. Multi-indicator view becomes a rainbow.
Fix: Define a `chart` palette in tailwind.config.js with 6 named roles. Import config values into chart components rather than repeating hex strings.
Command: /impeccable colorize

**[P2] No progressive disclosure for advanced controls**
Why: Ensemble weight sliders (advanced, rarely used) occupy as much visual space as ticker/range controls (used every session).
Fix: Collapse ensemble weights behind a `<details>` or disclosure toggle, default closed.
Command: /impeccable layout

**[P3] No help or onboarding**
Why: Terms like ADX, VWAP, Ensemble Conviction are unexplained. No tooltips anywhere.
Fix: Add `<abbr>` or tooltip on key technical terms. Empty state copy can teach the interface.
Command: /impeccable onboard

### Minor Observations
- Amber scrollbar hover (index.css) is a micro-decoration that contributes to drenching but is noticed subliminally.
- Error messages show raw API strings (`ECONNREFUSED`, `403`) — wrap with user-friendly message.
- "Metadata Explorer" is internal jargon — rename to something user-facing.
- Loading state has no min-height reservation, causing layout shift on load.
