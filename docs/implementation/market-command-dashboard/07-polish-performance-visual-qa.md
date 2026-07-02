# Phase 07: Polish, Performance, And Visual QA

Canonical Beads issue: `islandflow-mcmd.7`

Epic: `islandflow-mcmd`

Status is tracked in Beads. This doc is implementation context.

## Outcome

Tune the finished dashboard for density, stability, accessibility, reduced motion, and browser-verified production readiness.

## Scope

Allowed:

- Tune heights, sticky chrome, ticker rail speed, density, contrast, and row legibility.
- Verify reduced-motion behavior.
- Verify rail pause on hover/focus.
- Verify no nested cards or decorative dashboard tiles were introduced.
- Verify no page-level horizontal overflow on desktop and mobile.
- Verify live updates do not resize module headers or rows.
- Verify degraded ranking endpoint fallback remains usable.
- Capture desktop and mobile browser evidence.
- File Beads follow-ups for any issues that are outside this polish/QA scope.

Out of scope:

- New product surfaces.
- Ranking policy changes.
- Watchlist persistence.
- New websocket channels.
- Large module refactors unrelated to final polish and QA.

## Inputs

- Complete phases `islandflow-mcmd.1` through `islandflow-mcmd.6`.
- `apps/web/features/market-command/`
- `apps/web/app/globals.css`
- Existing browser tooling for local Chromium verification.

## Implementation Notes

- Amber remains scarce.
- Text must fit in buttons, labels, and rail items at mobile and desktop widths.
- Use stable dimensions for toolbar, rail, pane headers, rows, and drawer controls so live updates do not shift layout.
- On mobile, rail auto-loop remains disabled and manual horizontal scroll is the interaction.
- Browser QA should include:
  - desktop dashboard renders chart, alerts, flow packets, options tape, and news
  - mobile layout stacks without horizontal overflow
  - clicking `NVDA` in the rail scopes visible modules
  - alert row selection opens drawer and grid remains stable
  - flow packet activation focuses related contract/member prints
  - news focused/global ordering remains visible
  - endpoint failure shows local fallback rail
  - reduced-motion disables rail auto-loop

## Beads

- Epic: `islandflow-mcmd`
- Issue: `islandflow-mcmd.7`
- Depends on: `islandflow-mcmd.6`
- Parallel-safe: No. This phase validates the complete dashboard.

## Expected Files Or Areas

- `apps/web/features/market-command/`
- `apps/web/app/globals.css`
- Browser QA scripts or reports if the repo has a local convention.
- `docs/implementation/market-command-dashboard/turn-docs/islandflow-mcmd.7.md`

## Suggested Swarms

- Visual QA swarm: desktop, tablet, mobile, and reduced-motion checks.
- Performance scout: watch for polling, re-render, and layout shift risks.
- Accessibility scout: keyboard focus, rail buttons, drawer close, labels, and contrast.
- Browser automation scout: gather screenshots/probes and summarize failures.
- Follow-up triage scout: file Beads follow-ups for out-of-scope issues.

## Quality Gates

```bash
bun test
bun --cwd=apps/web run build
```

Real browser verification is required for desktop and mobile viewports. Document any blocked browser step with exact command/error and keep Beads open unless the closeout state is defensible.

## Completion Criteria

- Desktop and mobile screenshots show stable layout.
- Ticker rail does not cause layout shift.
- Live updates do not resize module headers or rows.
- Reduced motion is respected.
- Contrast and row legibility are acceptable.
- No nested cards or decorative dashboard tiles are present.
- Degraded/local fallback rail renders clearly.
- Phase turn doc records implementation, review, CI/gates, browser evidence, Beads updates, follow-ups, and final closeout.

## Follow-Up Policy

Do not widen this phase. File Beads follow-ups for future dashboard refinements, ranking policy calibration, watchlist editing, or new data surfaces.
