# CODING_STYLE.md — TypeScript + Bun Conventions

This document defines **local coding conventions** for this repository.  
It exists to reduce drift, improve readability, and keep AI-generated code consistent.

This is **not** a general style guide. It encodes *project-specific preferences*.

---

## Language & Runtime

- **TypeScript only**
- **Bun runtime required**
- Target modern JS (ES2022+)
- Prefer ESM everywhere

No Node-only APIs unless explicitly unavoidable and documented.

---

## File & Module Structure

- One logical responsibility per file.
- Avoid “god files.”
- Prefer small, composable modules over deep inheritance.

### Naming
- Files: `kebab-case.ts`
- Types / interfaces: `PascalCase`
- Functions / variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE` (rare)

Examples:
- `flow-packet.ts`
- `compute-aggressor-score.ts`
- `infer-absorption.ts`

---

## Types & Schemas

- **All external data must be validated**
  - Use `zod` schemas at boundaries (ingest, API).
- Internal functions may assume validated input.
- Prefer explicit types over inference when crossing module boundaries.

Avoid:
- `any`
- implicit `unknown` without narrowing

---

## Error Handling

- Fail **loudly and explicitly**.
- Prefer throwing typed errors over silent fallbacks.
- Log errors with structured context:
  - service name
  - event id
  - ticker / contract id (if applicable)

Never swallow errors in ingestion or compute paths.

---

## Async & Concurrency

- Prefer async/await over promise chains.
- Streaming > batching when possible.
- Avoid unbounded concurrency.
- Backpressure must be explicit.

Never block the event loop for UI convenience.

---

## Determinism Rules

- No time-based randomness.
- No reliance on implicit system state.
- Given the same inputs, outputs must be identical.

Live execution and replay execution must share code paths.

---

## Comments & Documentation

- Comment **why**, not **what**.
- If logic is subtle, explain assumptions.
- Avoid speculative language in comments.

Good:
// Join window bounded to reduce NBBO misalignment during bursts

Bad:
// This seems to work better
