# Smart-Flow Alerts Context

## Glossary

**Smart-flow alert** - A triage event derived from a non-abstained smart-flow hypothesis or insight. It is not an independent classifier and does not own inference semantics.

**Hypothesis alert** - User-facing copy for a smart-flow alert. Use this phrase when the UI needs to make uncertainty visible.

**Legacy derived path** - The old derived smart-money, classifier-hit, and alert event path. It includes `SmartMoneyEvent`, `ClassifierHitEvent`, and legacy `AlertEvent` public/runtime surfaces.

**Dropped derived history** - The final cutover decision that old smart-money, classifier-hit, and legacy-alert history is not backfilled. Raw market data and canonical smart-flow history remain the durable source of truth.

**Shared smart-flow tint** - The frontend tinting model that maps hypothesis type, direction, policy confidence, evidence quality, and abstention state into row hue and intensity.
