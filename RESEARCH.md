# RESEARCH.md — Signal Evaluation & Backtesting Discipline

This document defines **how research is conducted and interpreted** in this repository.

Its purpose is to **prevent self-deception**, not to slow exploration.

---

## Core Research Principles

- **No hindsight**
- **No intent claims**
- **No performance without context**
- **No conclusions without uncertainty**

All results are provisional unless explicitly validated.

---

## Fact vs Inference

- Raw market data = **fact**
- Classifiers, signals, and labels = **inference**

Inference must always:
- reference its evidence
- expose confidence
- be stored separately from raw data

---

## Labeling Rules

Every evaluation must specify:
- Time horizon (e.g. 5m, 15m, 60m)
- Metric (return, vol expansion, MAE/MFE, etc.)
- Directional vs volatility outcome
- Entry definition (event time, next tick, next candle)

No implicit labels. Ever.

---

## Backtesting Constraints

- No lookahead bias
- No survivorship bias
- Use only data available **at the event timestamp**
- OI snapshots must match the event date

Replay pipelines must mirror live pipelines exactly.

---

## Evaluation Metrics (minimum set)

At least one of:
- Precision / recall
- Hit rate vs baseline
- Forward return distribution
- Vol realized vs implied
- Calibration (probability vs outcome)

Single “win rate” numbers are insufficient.

---

## Regime Awareness

Results must be contextualized by:
- Market regime (trend / chop / high vol)
- Time of day
- DTE bucket
- Liquidity conditions

If a signal only works sometimes, that’s still information.

---

## Threshold Tuning Rules

- Thresholds may be tuned **only** on a defined training window.
- Validation must occur on disjoint data.
- Never tune on the same period you report.

Document when thresholds change and why.

---

## Language Discipline

Allowed:
- “suggests”
- “consistent with”
- “correlated with”
- “higher likelihood”

Disallowed:
- “smart money”
- “institutional intent”
- “guaranteed”
- “predicts”

---

## Recording Results

For each classifier or hypothesis, record:
- What was tested
- What failed
- What partially worked
- What conditions mattered

Failed ideas are assets. Keep them.

---

## Final Reminder

This system is for **understanding behavior**, not for proving superiority.

If a result cannot survive replay, uncertainty, and explanation,
it does not belong in production logic.
