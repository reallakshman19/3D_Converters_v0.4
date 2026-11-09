# WIP-pr56-pcom-weight — RIGID pointer / PCOM UNKNOWN weight bridge

# CURRENT RECOVERY STATE — READ FIRST

## Recovery header

```text
HANDOVER_READINESS: READY
PR_RECOVERY_STATE: HEALTHY
TAKEOVER_AUTHORITY: WRITE_ALLOWED
EXECUTION_MODE: MANUAL
MERGE_AUTHORITY: OWNER_ONLY
REPOSITORY: reallakshman19/3D_Converters_v0.4
SOURCE_TASK: Owner request 2026-11-07 to fix merged PR #5/#6 RIGID-pointer and PCOM/UNKNOWN weight behavior
PR_OR_WIP: WIP-pr56-pcom-weight
BRANCH: codex/fix-pr56-rigid-pcom-weight-20261107
PR_HEAD_OBSERVED: NOT_ALLOCATED
REPORT_BASIS_HEAD: e0939f05833d37fba201ba748aa09372560dc051
MAIN_HEAD_LAST_CHECKED: e0939f05833d37fba201ba748aa09372560dc051
MERGE_BASE: e0939f05833d37fba2016ba748aa09372560dc051
REPORT_SYNC: CURRENT
APPENDIX_A_STATUS: QUALIFIED_96_OF_100
GROUNDING_EPOCH: GE-PR56-FIX-001
CURRENT_STAGE: PLAN
CURRENT_BLOCKER: NONE
HIGHEST_RISK: Incorrectly promoting an empirical UNKNOWN suggestion to physical-mass authority
EXACT_NEXT_ACTION: Back up the two existing production files, then implement the explicit PCOM override bridge and native physical-owner binding without changing pointer layout or automatic-estimate policy.
```

## Handover in 60 seconds

- PR #6 (`1605b475`, merge `5f61d2a`) and PR #5 (`71c3c6f`, merge `7e09f75`) are already on `main`.
- The supplied HTML (`Rigid weight assignment.html`, SHA-256 `ea747c33b268c9c77a17767f1450703c94bd337cf5c28ac45e49de823b71a881`) correctly separates CII element pointer lookup from physical mass ownership.
- `parseCiiRigidElementWeights()` correctly reads the second integer pointer as a one-based `RIGID` index. Do not change CII pointer layout.
- Current run parity excludes `PCOM` from explicit weight propagation and aliases unnumbered records by `branch|NodeNumber=-1`.
- The native parser drops nonpositive NodeNumber records, so the writer cannot bind an explicitly entered PCOM/UNKNOWN weight to the emitted connection RIGID.
- Actual Owner XML contains 14 two-endpoint PCOM components, all 12.7 mm and all currently zero weight. Current real native execution emits 342 elements, 53 RIGID records, and 0 positive RIGID weights.
- Actual Owner configuration produces empirical advisory values of 1.748 kg for the physical 12.7 mm PCOM and 2.628 kg for a hypothetical 19.1 mm physical component. The emitted route is 19.1 mm, but the source PCOM is 12.7 mm.
- Scope is to carry an explicit saved PCOM/UNKNOWN override through the exact physical component to the owning RIGID record. Empirical suggestions remain non-automatic and unapproved until explicitly entered.

## Mission, scope, and invariants

Acceptance:

1. Exact PCOM override identity survives `NodeNumber=-1` records without cross-applying to sibling PCOMs.
2. Native writer selects the positive mass of the unique overlapping PCOM component instead of the adjacent flange endpoint mass.
3. Actual CII audit resolves the emitted element through its existing pointer and confirms PCOM component conservation.
4. A zero/unresolved PCOM cannot inherit the neighboring flange mass.
5. The 109 mm flange retains its own mass; no master, tolerance, topology, pointer format, unit scale, or automatic-approval policy changes.

Explicit non-goals: automatic empirical approval, historical CII repair, split-weight propagation, PR #2/#3 work, workflow changes, R2 redistribution, or merge without Owner authorization.

## Ground truth and coordination

- `main`: `e0939f05833d37fba2016ba748aa09372560dc051` at 2026-11-07 grounding.
- Open PR #9 changes Preview-cache/evidence files only; no exact-file or authority overlap.
- Open PR #4 is a read-only witness and does not change the planned production paths.
- Remote `audit/pr5-pr6-pcom-unknown-combined-20261107` adds audit workflow/script only; useful evidence, not a production implementation source.
- Coordination classification: `SAFE` for exact files; `COORDINATION_REQUIRED` only at shared XML/CII mass-authority semantics.

## Current diagnosis

```text
Observed symptom: PCOM/UNKNOWN weight can be reviewed but cannot reach native CII ownership.
Hypothesis: two independent gaps cause the loss: JS parity excludes/miskeys PCOM, then Python drops PCOM source spans before edge weight selection.
Supporting evidence: source inspection plus current-main real GLRD execution (342 elements / 53 RIGIDs / 0 positive weights).
Falsifier: an explicit distinct PCOM override already appears on the correct XML endpoint and produces the correct pointer-resolved RIGID mass on current main.
Next experiment: focused synthetic end-to-end override -> XML -> native CII -> PR #5 parser/audit, followed by actual GLRD run with an isolated temporary override.
```

## Validation ledger

| Check | Status | Observation | Oracle | Result |
|---|---|---|---|---|
| PR #5 pointer/audit tests | PASS | LOCAL_EXECUTION | IMPLEMENTATION_COUPLED | Node tests pass; pointer 40 maps to 150 N in frozen historical fixture |
| PR #6 native guard tests | PASS | LOCAL_EXECUTION | IMPLEMENTATION_COUPLED | 13/13 Python tests pass |
| Actual Owner source geometry | PASS | ARTIFACT_INSPECTION | USER_SUPPLIED | 14 PCOM groups, each 12.7 mm |
| Current real native baseline | PASS | LOCAL_EXECUTION | INDEPENDENT_REPRODUCTION | 342 elements, 53 RIGIDs, 0 positive weights |
| Actual config UNKNOWN estimate | PASS | LOCAL_EXECUTION | ANALYTICAL | 12.7 mm -> 1.748 kg; 19.1 mm -> 2.628 kg; both estimate-only |
| Full browser UI | NOT_RUN | NOT_OBSERVED | NONE | Required after implementation if local browser permits |

## Appendix A — implementation takeover qualification

Basis: current `main@e0939f0`, merged PR #5/#6 diffs, current source/tests, actual Owner XML/config, GE-PR56-FIX-001.

| Challenge | Repository evidence and disposition | Score |
|---|---|---:|
| A1 Production trace | Traced config override -> run parity -> XML Weight -> native parser/edge -> RIGID payload -> ELEMENTS pointer -> PR #5 audit | 20/20 |
| A2 Failure isolation | Isolated PCOM exclusion/`-1` identity alias and native source-span discard; falsifier recorded | 20/20 |
| A3 Authority/invariants | Explicit override is the only new writer input; estimate remains advisory; pointer/flange/topology invariants frozen | 20/20 |
| A4 Independent validation | Actual 12.7 mm Owner geometry, real config anchors, analytical 15*12.7/109, and emitted-byte pointer parse separated from implementation tests | 18/20 |
| A5 Minimal patch | Two production boundaries plus focused tests; no workflow/master/tolerance/pointer changes | 18/20 |
| **Total** | **Qualification passed; every challenge >=17** | **96/100** |

## Changed-file ledger

Planned production paths:

- `tabs/xml-cii-2019-standalone/xml-cii-standalone-run-parity.js`
- `converters/scripts/xml_to_cii2019.py`

Planned focused tests:

- `tests/test_xml_cii_native_rigid_owner_guard.py`
- `tests/test_xml_cii_native_cli_guard.py`
- a focused JS parity identity regression if existing harness supports executable DOM behavior

Recovery metadata:

- `agents/WIP-pr56-pcom-weight_workreport.md`
- `agents/status/WIP-pr56-pcom-weight.yaml`
- `agents/claims/WIP-pr56-pcom-weight.yaml`

