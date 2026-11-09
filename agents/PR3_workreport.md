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
## Independent review R1 — IR-02/IR-03 response, 2026-11-05
Review supplied by Owner: CONDITIONAL / MERGE HOLD; no independent eligibility/PASS claimed.
Prior head: `204f324829bc53bf0b9cc56c6c75516742aa8c77`.
Forward commits: `e28cbee9` content validation, `952fca13` negative tests,
`790e074d` lazy weight-content signature, `de46201c` miss-path regression tests.
Full final head: re-read GitHub after updating this report.

### Changed-file scope in R1
- `tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-preview-per-build-cache.js`: added plain JSON-like data signatures of each master/config, checked on cached hits. Same-object weight row/setting changes invalidate cached ranking; same-array class row changes invalidate index. Nonserializable/unsupported inputs fail open where detected. Weight config signature captured once after the ranker normalizes defaults; repeated *distinct* contexts do not scan the master, and matching contexts verify content before reuse. Added counters `classInvalidations`, `rankInvalidations`, `rankClones`, `rankSignatureChecks`. No numerical authority changed.
- `tests/xml-cii-preview-per-build-cache.test.mjs`: 5 additional tests (now 9 total) for same-object weight/class changes, changes to config settings, fail-open, miss-path mutation, lazy signature checks.
- Existing original backup snapshots remain preserved. New tests and change are in the same DRAFT PR #3.

### Actually executed evidence (this session)
1. PASS: V8 evaluated exact modified GitHub production module with injected deterministic class/ranking resolvers and explicit cloning. 20 distinct contexts produced only one initial weight signature; identical hit preserved; in-place 10→20 weight edit invalidated; in-place 93833→93834 class edit invalidated; mutation followed by another-context miss still invalidated before any old result hit; nonserializable config fell open. Example stats: classBuilds=2, classHits=1, classInvalidations=1, rankComputes=24, rankHits=1, rankInvalidations=2, rankSignatureChecks=6. These are isolated V8 source checks, **not full native Node tests**.
2. PASS: independently reran uploaded GLRD BM2 staged-evidence local Node benchmark: `node /mnt/data/GLRD_staged_wall_benchmark.mjs /mnt/data/glrd_ir3/stage.json /mnt/data/GLRD_branch_names.json`; 31 branches, 1141 equal evidence records, 27 nonempty; median old 318.88ms vs indexed 69.72ms = 4.57x operation-only. This validates PR #2's isolated lookup algorithm, not PR #3's cache speedup.
3. Measured content-signature overhead on actual user-supplied GLRD XLSX masters, converted to JSON-like rows locally: 1595 weight records, 270 repeated signature calls, median 1.577ms/call, aggregate 449.292ms; 10699 Piping Class records, 3 calls, median 12.253ms/call, aggregate 39.251ms. This is a benchmark of signature overhead, **not** whole Preview or class/ranking cache hit ratios. Lazy signature patch specifically avoids full weight scans for unique ranking contexts.
4. Git clone attempt `timeout 12s git ls-remote https://github.com/reallakshman19/3D_Converters_v0.4.git HEAD` failed DNS `Could not resolve host: github.com`. Connected GitHub source checks and local Node microbenchmarks work, but there is no native repository checkout.

### Outstanding hard holds
- Native committed Node regression suites on exact final head: **NOT_RUN**.
- Real GLRD BM2 full Step 4 config/Chromium Build, Rebuild, Fetch Rating and downstream XML/CII parity: **NOT_RUN**.
- Real GLRD PR #3 cache class/rank hit ratio, clone overhead, net Preview speedup: **NOT_MEASURED** (Owner config absent).
- Existing persistent Preview cache fingerprint is known weak; unchanged, qualify with forced fresh builds, do not infer cache safety from warm runs.
- Independent engineering-critical score >=92 overall/17 each: **NOT_SCORED**; remain DRAFT / MERGE HOLD.

### Stop rule
If PR #3 produces any differing engineering result or is not a net Preview improvement on real Owner configuration after accounting for signatures and cloning, do not merge it; consider parking or removing ranking memoization while preserving PR #2's independent performance improvement. Do not alter engine/writer/Line List/strict-line policy.

### EXACT_NEXT_ACTION
At final PR #3 head after this report commit, run `node --test tests/xml-cii-preview-per-build-cache.test.mjs tests/xml-cii-preview-strict-line-authority.test.mjs tests/xml-cii-preview-rating-authority.test.mjs tests/xml-cii-preview-wall-evidence-index.test.mjs tests/xml-cii-preview-wall-authority-parity.test.mjs tests/xml-cii-weight-match-preview-rating-snapshot.test.mjs`; run owner-config GLRD Chromium on main/PR2/PR3 with forced fresh builds; compare full Preview rows, source evidence, enriched XML and CII bytes and collect class/rank hit/clone counts; seek fresh independent review at exact final head. Do not merge.
