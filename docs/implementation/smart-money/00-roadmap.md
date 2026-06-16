# Smart Money / Smart Flow Roadmap

This roadmap breaks `docs/plans/smart-flow-architecture-review.md` into implementation-sized phases. The recommended direction is Option B: keep the working stack, but rebuild the domain pipeline around observations, evidence clusters, cautious hypotheses, confidence, alternatives, abstention, replay evaluation, and user-facing insight projections.

## Core Constraints

- Do not treat "smart money" as a canonical fact emitted by the system.
- Distinguish direct facts, evidence, hypotheses, confidence, alternatives, and abstention.
- Preserve evidence and uncertainty in storage, API, websocket, and UI surfaces.
- Keep Redis as hot cache only, not hidden baseline truth.
- Make replay evaluation the acceptance gate before expanding UI confidence.
- Keep historical or research-grade calibration as future work, not an MVP dependency.

## Phase Sequence

| Phase | Beads issue | Depends on | Purpose |
| --- | --- | --- | --- |
| 01 - Contracts and vocabulary | `islandflow-zxh.1` | `islandflow-259.1` | Define evidence/hypothesis/insight contracts and retire canonical overconfidence. |
| 02 - Evidence clustering and features | `islandflow-zxh.2` | `islandflow-259.2` | Extract eligibility, evidence facts, clusters, and traceable features. |
| 03 - Hypothesis scoring and abstention | `islandflow-zxh.3` | `islandflow-259.3` | Score cautious hypotheses and represent abstention/alternatives. |
| 04 - Replay evaluation and golden tests | `islandflow-zxh.4` | `islandflow-259.4` | Validate derived outputs through deterministic replay and golden fixtures. |
| 05 - API/UI explainability | `islandflow-zxh.5` | `islandflow-259.5` | Expose evidence-backed insights and uncertainty to API, WS, and UI. |
| 99 - Future calibration | `islandflow-zxh.6` | `islandflow-zxh.5`, `islandflow-259.6` | Calibrate confidence and policy behavior later with richer datasets. |

## PR Split Notes

Several phases are broad enough to split before implementation:

- `islandflow-zxh.2.1` - Split smart-flow phase 02a: eligibility and evidence facts
- `islandflow-zxh.2.2` - Split smart-flow phase 02b: clustering and feature vectors
- `islandflow-zxh.3.1` - Split smart-flow phase 03a: hypothesis score vectors
- `islandflow-zxh.3.2` - Split smart-flow phase 03b: abstention and insight projection
- `islandflow-zxh.5.1` - Split smart-flow phase 05a: evidence API and websocket surfaces
- `islandflow-zxh.5.2` - Split smart-flow phase 05b: UI explainability surfaces

If an implementation PR crosses contracts, compute, storage, API, and UI in one change, stop and split it.

## Matching Beads Epic

- `islandflow-zxh` - Plan smart-money to smart-flow implementation phases
