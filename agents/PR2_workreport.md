# PR #2 — XML/CII Step 4 Preview staged-wall index
**Recoverable current truth, 2026-11-05**
Repo: https://github.com/reallakshman19/3D_Converters_v0.4
Issue: https://github.com/reallakshman19/3D_Converters_v0.4/issues/1
PR: https://github.com/reallakshman19/3D_Converters_v0.4/pull/2 (DRAFT, UNMERGED)
Base: `b856ddd01a66c0dbee8c519bfd0bd8118d1f3979`
Branch: `perf/xml-cii-v04-preview-wall-index-20261105`
Last known head before this report: `3e2740b0c6129bfbc8d08f3cbb909b759281eb2a`.
Latest PR head SHA and CI must be re-read from GitHub before proceeding. The final head is also posted as a PR comment.

## Mission, modifications, backups
ENGINEERING_CRITICAL; one staged-JSON parse/index per Step 4 wall-authority invocation, with unchanged engineering evidence/output. No changes outside this work pack.
Production: `tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-preview-wall-evidence.js`, `xml-cii-adapted-preview-bore-wall-authority.js`.
Tests: `tests/xml-cii-preview-wall-evidence-index.test.mjs`, `tests/xml-cii-preview-wall-authority-parity.test.mjs`.
Unmodified source backups: `.backups/connector-20261105-preview-wall-index/`.
A prior WIP record exists at `agents/WIP-V04P1_workreport.md` and contains test recipes and engineering invariants.

## Validation ledger
- PASS — original v0.4 production file blob SHA identities match v0.5a pre-PR2 originals exactly. Ported two-file implementation blob SHAs match v0.5a PR2 qualified code: `00927d9b7bd55adecb97ea421e9fc2a610245071`, `af85d0f7b9866d1348a1fca5672acc0faa61db54`. Inherited source equality, not native new-branch test.
- PASS — local GLRD reproduced-algorithm microbenchmark: `node /mnt/data/GLRD_staged_wall_benchmark.mjs /mnt/data/glrd_work/STF_2026Nov03-0839_managed_stage.json /mnt/data/GLRD_branch_names.json`: 31 branch names, 1141 ordered evidence records, equal; median 415.49 ms old vs 92.14 ms indexed (4.51x operation-only). No full Preview speedup claim.
- NOT_RUN — native `node --test` suites in full v0.4 checkout; tests committed for runner and include saved-original authority comparison, parse count and optional real GLRD.
- NOT_RUN — full Chromium Step 4 Build/Rebuild/DTXR and downstream enriched XML/CII output parity; effective Owner config absent.
- NOT_RUN — independent review and engineering-critical eligibility threshold >=92 overall, >=17 each. Do not claim PASS/merge-ready.
- NOT_RUN — exact `node utils/backup.js` command; originals preserved as actual repository snapshot backups because connector does not provide a checked-out working tree.

## Risks, hypothesis/falsifier, action
Highest risk: an unnoticed wall-selected-evidence/provenance difference, not raw lookup speed. Falsifier: any nonidentical Preview branch/node result or downstream conversion byte values.
Before continuation recheck base drift, other WIPs/PRs, and full file diff. Do NOT merge. Do not use private GLRD input as repo fixture.
**EXACT_NEXT_ACTION:** run the 6 targeted Node Preview tests from WIP report in a v0.4 checkout and an exact Owner-config Chromium BM2 comparison; post commands/counts and independent review. If FAIL, forward-fix within two production files only; otherwise request independent review and Owner merge decision.