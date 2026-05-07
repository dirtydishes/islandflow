# Next.js Upgrade Plan: `14.2.35` -> `16.2.4` (via v15 compatibility pass)

## Summary

As of **May 5, 2026**, the web app is on Next `14.2.35` (locked) with React `18.3.1`, while npm `latest` for `next` is `16.2.4`.

Based on repo inspection, risk is **moderate-low** for this app because it uses App Router with minimal server-only APIs and no custom webpack/middleware. The main required migration is the React 19 + Next 15/16 compatibility surface.

## Current-State Findings

- Declared deps: [apps/web/package.json](/Users/kell/Cloud/dev/islandflow/apps/web/package.json:13)
- Locked Next version: [bun.lock](/Users/kell/Cloud/dev/islandflow/bun.lock:241)
- Next config is simple (`distDir` only), no webpack/turbopack overrides: [apps/web/next.config.mjs](/Users/kell/Cloud/dev/islandflow/apps/web/next.config.mjs:1)
- App Router only (`app/*`), no route handlers or middleware in `apps/web`
- No `cookies()`, `headers()`, `draftMode()`, or `params/searchParams` async-migration hotspots found in `apps/web/app`
- Baseline build passes on current branch (`bun --cwd=apps/web run build`)

## Public APIs / Interfaces / Types Impact

- External API contracts for the project: **no intentional changes**
- Dependency interface upgrades required:
- `next` -> `16.2.4`
- `react` / `react-dom` -> `19.x`
- `@types/react` / `@types/react-dom` -> latest 19-compatible
- If future server components introduce request APIs, they must follow async forms from v15+ (`await cookies()`, etc.)

## Implementation Plan

1. Create an upgrade branch and snapshot baseline:
   - Record current `bun --cwd=apps/web run build` and `bun test` status.
2. Upgrade deps in `apps/web`:
   - Bump `next`, `react`, `react-dom`, and React type packages to latest compatible.
   - Run install and refresh lockfile.
3. Run codemod-assisted checks:
   - Use Next codemod guidance for v15/v16 migration candidates.
   - Verify no required transforms are missed, especially async request APIs and config migrations.
4. Validate Next 16 runtime/build behavior:
   - `bun --cwd=apps/web run build`
   - `bun --cwd=apps/web run dev` smoke test for `/`, `/tape`, and redirect routes.
5. Validate tests:
   - `bun test apps/web/app/routes.test.ts`
   - `bun test apps/web/app/terminal.test.ts`
   - `bun test` repo-wide if CI parity is expected.
6. Fix issues discovered in validation:
   - Resolve React 19 typing/hook warnings if any appear.
   - Confirm no changed behavior in navigation/replay/tape flows.
7. Final verification:
   - Re-run build and relevant tests.
   - Capture upgrade notes, what changed, what was checked, and residual risk.

## Test Cases and Scenarios

- Build:
  - Production build succeeds (`next build`) with Next 16 + React 19.
- Routing:
  - `/` and `/tape` render correctly.
  - `/signals`, `/charts`, `/replay` still redirect to `/`.
- Client navigation/cache behavior:
  - `<Link>` navigation between Home/Tape remains correct under updated client cache semantics.
- Live/replay terminal UI:
  - No regressions in fetch-driven panels and websocket-driven status behavior.
- Type safety:
  - No TypeScript errors from React 19 types in terminal-heavy UI code.
- Regression check:
  - Existing Bun tests continue to pass.

## Assumptions and Defaults Chosen

- Target selected: **Next 16 latest**
- Default strategy: **single upgrade stream with v15 compatibility checks included**, not a prolonged 14 -> 15 -> 16 rollout, because the code has low exposure to v15 breaking server APIs
- No custom webpack migration required unless hidden plugin behavior introduces it
- No expected changes to backend service contracts or shared `@islandflow/types` interfaces

## Official References

- Next 15 upgrade guide: https://nextjs.org/docs/app/guides/upgrading/version-15
- Next 16 upgrade guide: https://nextjs.org/docs/app/guides/upgrading/version-16
- Next 15 release notes: https://nextjs.org/blog/next-15
- npm package page: https://www.npmjs.com/package/next
