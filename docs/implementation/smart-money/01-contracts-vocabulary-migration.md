# Smart-Flow Phase 01 Migration Notes

These notes accompany Beads issue `islandflow-zxh.1` and the contracts in
`packages/types/src/smart-flow.ts`.

## Canonical language

The canonical contract family is `smart-flow`, not `smart-money`.

- Observations are direct references to market, news, calendar, or fixture inputs.
- Evidence facts are normalized statements derived from observations.
- Evidence clusters group candidates, facts, baselines, and evidence quality.
- Hypotheses are policy/model outputs over evidence, not facts about hidden participants.
- Confidence vectors describe policy confidence, evidence quality, margin, conviction, and
  calibration status separately.
- Abstention is a first-class output with reasons and source reasons.
- Insights are user-facing projections from hypotheses.

## Compatibility posture

Existing `SmartMoneyEvent` feeds, storage tables, and UI paths stay compatibility surfaces for
phase 01. They should not be expanded as canonical domain language.

New implementation phases should target these contracts first:

- `FlowCandidate`
- `FlowEvidenceCluster`
- `FlowHypothesisEvent`
- `SmartFlowInsight`
- `EvidenceQuality`
- `BaselineSnapshot`

`SmartMoneyInsight` remains as a deprecated alias for `SmartFlowInsight` so existing API/UI naming
can migrate without implying a hidden-participant fact.

## Versioning

Top-level smart-flow contracts carry `schema_version`. Hypothesis and insight outputs also carry
`policy_version`; hypotheses carry `model_version` for future scoring evolution.

The initial constants are:

```ts
SMART_FLOW_CONTRACT_VERSION = "smart-flow.contracts.v1"
SMART_FLOW_POLICY_VERSION = "smart-flow.policy.compat.v1"
SMART_FLOW_MODEL_VERSION = "smart-flow.model.unscored.v1"
```

The current policy/model versions are compatibility placeholders. They document the contract shape
before phase 02 and phase 03 add evidence extraction and hypothesis scoring behavior.

## Migration risks

- Renaming current storage or live channels in phase 01 would break consumers, so this phase keeps
  `smart-money` as the existing channel name.
- Treating legacy profile IDs as canonical participant identity would preserve the old
  overconfidence. The compatibility projection maps them to hypothesis types instead.
- Adding scoring behavior here would cross into phase 03. This phase only defines contracts and
  projections.
