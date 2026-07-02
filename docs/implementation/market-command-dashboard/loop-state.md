# Loop State

Canonical tracker: Beads epic `islandflow-mcmd`

This file is a compact resume aid only. If this file disagrees with Beads, Beads wins.

Status: active

Stream: `market-command-dashboard`

Workflow: `orchestrator-callback`

Current phase: none

Current Beads issue: none

Current PR: none

Last completed phase: 04 - Dashboard layout replacement (`islandflow-mcmd.4`)

Blocked: no

## Decisions

- Root `/` is replaced directly; no hidden v2 route is created.
- `NAV_ITEMS` remains labeled `Dashboard`.
- Server important-now ranking drives the ticker rail, with local fallback visibly labeled.
- Board focus is first-class and scopes chart, alerts, flow packets, options tape, and news.
- Durable row panes are preferred over raw fallback modules.
- Detail is hybrid: hover/compact previews inline, deep evidence in one shared drawer.
- UI stays dark, flat, dense, and terminal-native. Amber stays scarce.

## Context To Keep

- Default pinned watchlist: `SPY`, `QQQ`, `NVDA`, `TSLA`, `AAPL`, `MSFT`, `META`, `AMZN`.
- Ranking endpoint: `GET /market-command/tickers?watchlist=SPY,QQQ,NVDA,TSLA,AAPL,MSFT,META,AMZN&limit=16`.
- Current session means current or most recent regular market session from 9:30 AM America/New_York.
- Route feature changes must not alter `/qa`, `/options`, or `/news`.
- Worker/reviewer threads must receive a literal orchestrator thread id and callback exactly once.

## Phase Ledger

| Phase | Beads Issue | Status | PR | Turn Doc |
|---|---|---|---|---|
| 01 - Server ranking contract | `islandflow-mcmd.1` | Closed, merged via PR #102 into `dashboard-v2` | `https://git.dirtydishes.dev/dirtydishes/islandflow/pulls/102` | `docs/implementation/market-command-dashboard/turn-docs/islandflow-mcmd.1.md` |
| 02 - Ticker rail and board focus model | `islandflow-mcmd.2` | Closed, merged via PR #103 into `dashboard-v2` | `https://git.dirtydishes.dev/dirtydishes/islandflow/pulls/103` | `docs/implementation/market-command-dashboard/turn-docs/islandflow-mcmd.2.md` |
| 03 - Root route feature upgrade | `islandflow-mcmd.3` | Closed, merged via PR #104 into `dashboard-v2` | `https://git.dirtydishes.dev/dirtydishes/islandflow/pulls/104` | `docs/implementation/market-command-dashboard/turn-docs/islandflow-mcmd.3.md` |
| 04 - Dashboard layout replacement | `islandflow-mcmd.4` | Closed, merged via PR #105 into `dashboard-v2` | `https://git.dirtydishes.dev/dirtydishes/islandflow/pulls/105` | `docs/implementation/market-command-dashboard/turn-docs/islandflow-mcmd.4.md` |
| 05 - Hybrid detail drawer model | `islandflow-mcmd.5` | Open, blocked by `islandflow-mcmd.4` | None | `docs/implementation/market-command-dashboard/turn-docs/islandflow-mcmd.5.md` |
| 06 - News relevance ordering | `islandflow-mcmd.6` | Open, blocked by `islandflow-mcmd.5` | None | `docs/implementation/market-command-dashboard/turn-docs/islandflow-mcmd.6.md` |
| 07 - Polish, performance, and visual QA | `islandflow-mcmd.7` | Open, blocked by `islandflow-mcmd.6` | None | `docs/implementation/market-command-dashboard/turn-docs/islandflow-mcmd.7.md` |

## Last Coordinator Update

2026-07-02: Review callback approved Phase `islandflow-mcmd.4` with `ci-green`. Orchestrator merged PR #105 into `dashboard-v2` at merge commit `fe08df5`, closed Beads issue `islandflow-mcmd.4`, and recorded Forgejo Actions task `#450` as green for final reviewer head `7e8b8fae30`.
