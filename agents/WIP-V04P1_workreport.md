# WIP-V04P1 — XML-CII Step 4 Preview staged-evidence indexing
Status: CODE_COMMITTED / REVIEW_REQUIRED / ENGINEERING_CRITICAL
Date: 2026-11-05
Issue: https://github.com/reallakshman19/3D_Converters_v0.4/issues/1
Base: `main@b856ddd01a66c0dbee8c519bfd0bd8118d1f3979`
Branch: `perf/xml-cii-v04-preview-wall-index-20261105`
Head at report creation: verify from GitHub after file commit.
PR: PENDING (do not merge; no approval given)
Scope: ONLY one-per-build staged wall-evidence indexing in Step 4 Preview; no rating/Line List/weight/strict-line/UI/engine/writer changes.

## Recovery / actual changes
- `tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-preview-wall-evidence.js`: exports `indexStagedBranchWallEvidence`, `collectIndexedStagedBranchWallEvidence`; retains legacy `collectStagedBranchWallEvidence` API.
- `tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-preview-bore-wall-authority.js`: builds staged index once after XML parse, reuses across branch row authority evaluation.
- `tests/xml-cii-preview-wall-evidence-index.test.mjs`: order, duplicates, canonical names, OWNER override, invalid JSON; optional GLRD evidence.
- `tests/xml-cii-preview-wall-authority-parity.test.mjs`: import original source from backup and compare whole branch/node row results; parse-count assertion; optional GLRD.
- Backups of both unmodified originals at `.backups/connector-20261105-preview-wall-index/` (original blob SHA `04ff82f24dfa9e7a112c17228d1fe24de0b32a55`, `0e1da4b804770864f84f388169780cf1c1903708`). Working through connected GitHub does not provide a local repo to execute `node utils/backup.js`; repository snapshots are preserved explicitly. Backup-script execution: NOT_RUN.

The two production files are copied byte-for-byte from the same-file change already independently exercised in `3D_Converters_v0.5a` PR #2 at `814157b162b981c9876f564f3cb0474435c8c37e`. This is inherited evidence, not qualification of the new v0.4 PR.

## Engineering invariants
Same ordered branch evidence arrays and duplicate records; same canonical branch normalization, OWNER precedence, DTXR and bore selection, counts/provenance, wall-thickness authority; same original XML, masters, material/process/rating, exported XML/CII bytes.
No parser or writer changes.

## Observed evidence (current session)
- `node /mnt/data/GLRD_staged_wall_benchmark.mjs /mnt/data/glrd_work/STF_2026Nov03-0839_managed_stage.json /mnt/data/GLRD_branch_names.json` — PASS local replicated algorithm parity, 31 branch names, 1141 evidence records, 27 nonempty.
- 7-run V8 stage-lookup medians: old 415.49 ms / index 92.14 ms / 4.51x; **not** full Chromium Step 4.
- Baseline exact app config and full browser Run parity: NOT_RUN (Owner config not supplied).
- `node --test tests/xml-cii-preview-wall-evidence-index.test.mjs tests/xml-cii-preview-wall-authority-parity.test.mjs`: NOT_RUN locally (GitHub-only source checkout). Existing strict-line/rating/cache/Weight Match tests: NOT_RUN.
- Real trace tests: NOT_RUN inside repo; optional tests require `GLRD_STAGE_FILE`, `GLRD_BRANCH_NAMES_FILE`, `GLRD_SOURCE_XML`.
- Independent reviewer gate >=92/100 and >=17/20 each: NOT_RUN.

## Risk / scope decisions
Review must verify full authority parity, not just evidence microbenchmark. GLRD BM2 has 31 XML branches but 86 staged BRANCH objects and 27 matching evidence-bearing XML branch names; no invented mappings. No automatic merging.
Hypothesis: avoid N repeated parse/walk while preserving every record; falsifier is any mismatch of evidence or wall/Preview/output values.
Coordination: live repository had only main and zero open PRs before branch; no known overlapping work.

## EXACT_NEXT_ACTION
In a checked-out PR head, run `node --test tests/xml-cii-preview-wall-evidence-index.test.mjs tests/xml-cii-preview-wall-authority-parity.test.mjs tests/xml-cii-preview-strict-line-authority.test.mjs tests/xml-cii-preview-rating-authority.test.mjs tests/xml-cii-preview-cache-v7.test.mjs tests/xml-cii-weight-match-preview-rating-snapshot.test.mjs`; with authorized GLRD files run optional tests; run Chromium Step 4 Build/Rebuild/Fetch Rating and downstream enriched XML/CII comparison against pinned base with effective imported Owner config. Record exact commands/counts. If any mismatch, STOP and fix only the regression. Independent engineering-critical review before any merge.