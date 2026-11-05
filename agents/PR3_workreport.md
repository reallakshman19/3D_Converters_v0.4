# PR #3 — XML/CII Step 4 exact-input per-build cache
**Status:** DRAFT / ENGINEERING_CRITICAL / UNMERGED / INDEPENDENT REVIEW PENDING
Issue #1: https://github.com/reallakshman19/3D_Converters_v0.4/issues/1
PR #2 prerequisite: https://github.com/reallakshman19/3D_Converters_v0.4/pull/2
PR #3: https://github.com/reallakshman19/3D_Converters_v0.4/pull/3
PR base branch: `perf/xml-cii-v04-preview-wall-index-20261105` @`a45ec1be5039462d345cccdda87e716b177c507e`
PR head prior to this report: `b24d372eb382aa6ccb7fd612f04910a4870bb84f` (see GitHub PR for current head)
Branch: `perf/xml-cii-v04-preview-per-build-cache-20261105`

## Scope and file ledger
- New `tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-preview-per-build-cache.js`: per-Preview invocation cache of Piping Class index by master identity; exact ranking context/options/config identity; safe cloned results; fail-open.
- Modified `tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-preview-dryrun-core.js`: optional per-build cache parameter and use during eligible node ranking.
- Modified `tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-preview-dryrun.js`: one cache per call, forwards it through strict branch calculation and rating.
- Modified `tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-preview-rating-authority.js`: use shared cache in final rating reranking and class resolution.
- New `tests/xml-cii-preview-per-build-cache.test.mjs` (4 tests); modified `tests/xml-cii-preview-strict-line-authority.test.mjs` only to explicitly provide test fixture new import.
- Four original source snapshots in `.backups/connector-20261105-preview-per-build-cache/`.
- Initial WIP report: `agents/WIP-V04P2_workreport.md`. No workflow changes.

## Exact grounding
All 4 modified existing files at the v0.4 worktree base were byte-identical to v0.5a PR #6's tested input at v0.5a PR #2. All ported source blobs match v0.5a PR #6 @`24917f2855d23473293797edf510872990a9d18c`.
Inherited v0.5a report records 22/22 targeted Node, 11/11 Python and controlled Chrome parity; these results are **NOT** new v0.4 test results and involve different GLRD fixture.

## Validation as of creation
- PASS (local V8 synthetic fixture): actual source module executed with counted resolver and cloning: 1 class build/1 hit, 2 exact weight computations/2 hits, modified returned candidate isolated, DTXR changes recompute, fresh invocation recomputes, unavailable clone fails open. This injection fixture is not a Node production suite.
- NOT_RUN: new PR #3 native Node tests, full Chromium Step 4 Build/Rebuild/Fetch Rating, Owner BM2 app imported configuration, final XML/CII parity, independent engineering-critical review (>=92/100, each >=17/20).
- NOT_RUN: `node utils/backup.js` (connected GitHub no local repo; exact original content preserved under .backups).
- No global persisted cache; no master/engineering authority, strict-line gate, XML writer, runtime or UI change.
- Class index identity reuse preserves raw rows. Ranking cache never conflates different exact primitive inputs; cloning failure recomputes.
- Falsifier: any divergent Preview row/result/provenance, Weight Match candidate, output bytes or stale override; STOP if found.

## EXACT_NEXT_ACTION
Check PR #2 merge/base state and PR #3 changed-file diff, then run `node --test tests/xml-cii-preview-per-build-cache.test.mjs tests/xml-cii-preview-strict-line-authority.test.mjs tests/xml-cii-preview-rating-authority.test.mjs tests/xml-cii-preview-wall-evidence-index.test.mjs tests/xml-cii-preview-wall-authority-parity.test.mjs tests/xml-cii-weight-match-preview-rating-snapshot.test.mjs` from PR #3 checkout. With supplied full Owner Step 4 config and real GLRD inputs run baseline-vs-PR #2-vs-PR #3 Chrome Build/Rebuild/Fetch Rating, compare full Preview rows/evidence and final enriched XML/CII, capture medians, memory and UI responsiveness. If tests fail: forward-fix only in scope, no weakened oracle. Request independent engineering-critical review. Do not merge without explicit Owner approval.