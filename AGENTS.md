# AGENTS.md — Execution Guardrails for Codex

This file defines **how Codex should think, act, and prioritize** when working in this repository.  
Its purpose is to keep development **focused, correct, and non-drifting**.

If there is any conflict between speed and correctness, **correctness wins**.

---

## Mission

Build a **real-time, non-delayed options flow and off-exchange trade analysis platform** for personal use that is:

- explainable
- deterministic
- replayable
- microstructure-correct
- low-latency
- built on **Bun**

Codex is an **engineering executor**, not a product visionary.  
Do not invent scope. Do not “improve” the plan. Implement it faithfully.

---

## Non-Negotiable Constraints

- **Bun is mandatory**
  - Use Bun for runtime, package manager, scripts, and dev tooling.
  - Do not introduce npm, yarn, pnpm, or Node-only assumptions.
- **TypeScript only**
  - No JS-only files unless unavoidable (and document why).
- **No black-box logic**
  - All classifiers must be rule-based and explainable.
- **Personal-use architecture**
  - No multi-user assumptions.
  - No redistribution mechanisms.
- **Deterministic pipelines**
  - Live behavior must match replay behavior.

If a change violates any of the above, **do not implement it**.

---

## Source of Truth

The authoritative documents are, in order:

1. `PLAN.md`
2. `AGENTS.md`
3. Code already merged into `main`

If a request contradicts `PLAN.md`, Codex must **stop and ask for clarification**.

---

## Development Rules

### 1. Never Skip the Event Layer
- All incoming market data becomes **immutable events**.
- Never compute directly off live feeds without persisting the event.
- Never add UI-only logic that bypasses persisted data.

### 2. Separate Fact from Inference
- Raw data (`OptionPrint`, `EquityPrint`) is **fact**.
- Classifiers and dark pool signals are **inference**.
- Store and label them separately.
- Never overwrite facts with inferred labels.

### 3. Explainability Is Required
Every classifier must:
- have a unique ID
- expose its inputs
- produce a human-readable explanation string
- link back to evidence prints

If an alert cannot explain itself, it is invalid.

### 4. Favor Simple, Explicit Logic
- Prefer clear thresholds over clever heuristics.
- Avoid premature ML or probabilistic tuning.
- If logic becomes complex, break it into named steps.

This is a research system, not a trading bot.

---

## Classifier Implementation Rules

- Classifiers operate on **FlowPackets**, not raw prints.
- Each classifier:
  - returns `{ confidence, direction, explanations[] }`
  - contributes to alert scoring but does not decide alerts alone
- Never infer intent with certainty.
- Use language like:
  - “likely”
  - “suggests”
  - “consistent with”
- Never use language like:
  - “smart money”
  - “institutional intent”
  - “guaranteed”

---

## Time & Market Structure Rules

- Always join prints to NBBO using bounded time windows.
- Track and expose join quality (`nbbo_age_ms`, etc.).
- Explicitly handle:
  - 0DTE
  - low-liquidity contracts
  - wide spreads
- If confidence is low, say so.

---

## Charting Rules

- Candles are built **server-side only**.
- Client never computes OHLC.
- Overlays must be viewport-aware and decimated.
- Performance beats decoration.

If a chart stutters, reduce data density first—not visual quality.

---

## UI Rules

- Prefer clarity over density.
- Every alert must be clickable to evidence.
- No “magic colors” without legend or explanation.
- Motion must feel physical, not flashy.

UI exists to **inspect**, not to impress.

---

## Observability & Safety

- Add metrics alongside new pipelines.
- Log failures explicitly.
- Never silently drop events.
- During overload:
  - persistence > compute > UI (in that priority order)

---

## What Codex Must NOT Do

- Do not invent new features or markets.
- Do not introduce predictive claims.
- Do not optimize prematurely.
- Do not refactor without reason.
- Do not replace explicit logic with ML.
- Do not broaden scope beyond personal use.

---

## When to Stop and Ask

Codex must pause and ask for guidance if:
- a data provider limitation blocks implementation
- licensing or entitlement assumptions change
- a requested change conflicts with `PLAN.md`
- a design decision affects determinism or replayability

---

## Definition of “Done”

A task is done only when:
- it matches `PLAN.md`
- it compiles and runs under Bun
- it is deterministic
- it is explainable
- it is testable or replayable

---

## Final Reminder

This system is built to **understand markets**, not to mythologize them.

If something cannot be justified by observable data and clear logic, it does not belong here.
