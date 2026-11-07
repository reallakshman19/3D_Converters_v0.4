# WIP-V04P2 — Step 4 exact-input per-build computation reuse
Status: CODE_COMMITTED / REVIEW_REQUIRED / ENGINEERING_CRITICAL
Issue: https://github.com/reallakshman19/3D_Converters_v0.4/issues/1
Upstream prerequisite PR #2: https://github.com/reallakshman19/3D_Converters_v0.4/pull/2
Base commit from PR #2: `a45ec1be5039462d345cccdda87e716b177c507e`
Branch: `perf/xml-cii-v04-preview-per-build-cache-20261105`
Expected PR: DRAFT stacked on PR #2 branch. No merge approved.
Related source code previously browser-qualified in v0.5a PR #6 @24917f2855d23473293797edf510872990a9d18c, with different reference GLRD inputs; inherited evidence, not this repository qualification.

## Scope / changes
- New `tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-preview-per-build-cache.js`: `createPreviewPerBuildCache` caches Piping Class index by master-array identity (WeakMap) and weight rankings by exact primitive context/options + config object identity; structuredClone isolates mutable ranking results; clone failures fail open; fresh cache per new synchronous Preview.
- `.../xml-cii-adapted-preview-dryrun-core.js`: optional per-build cache parameter to core and node scan.
- `.../xml-cii-adapted-preview-dryrun.js`: construct cache per invocation, pass to original + strict rebuild, final rating.
- `.../xml-cii-adapted-preview-rating-authority.js`: reuse index/rank only with same per-build cache.
- `tests/xml-cii-preview-per-build-cache.test.mjs`: direct precision/invalidation checks.
- `tests/xml-cii-preview-strict-line-authority.test.mjs`: explicitly stub added import in isolated fixture, no relaxed authority test.
- Four pre-edit file snapshots: `.backups/connector-20261105-preview-per-build-cache/` (backup script itself NOT_RUN under GitHub-only checkout).
- No algorithm/threshold/writer/engine/masters/Line List/strict gate or output semantics changed.

## Current validation / risk
- PASS: all four existing production file blobs at v0.4 base exactly equal to v0.5a PR #6's prior baseline PR #2 @814157b1; ported production source blobs match v0.5a PR #6 exact tested head.
- PASS: actual per-build cache source executed in V8 with injected synthetic resolvers/clone, demonstrating 1 class build+1 hit, 2 weight computations+2 hits, isolated mutation, fresh cache invalidation, and fail-open when clone unavailable. **This is not the Node suite.**
- NOT_RUN: native Node test suite (`node --test tests/xml-cii-preview-per-build-cache.test.mjs tests/xml-cii-preview-strict-line-authority.test.mjs ...`); no full checkout in container.
- NOT_RUN: actual imported Owner GLRD BM2 configuration + Chromium Step 4 Build, Rebuild, Rating, downstream XML/CII comparison.
- NOT_RUN: independent engineering-critical review (>=92 overall and >=17 each category).
- Hypothesis: repeated class index/rank work costs significant CPU on GLRD; falsifier: changed outputs, stale ranking, no speed benefit or regression against real GLRD.
- Highest risk: accidental merging of distinct DTXR/rating/config contexts. Cache only per invocation; exact context and clone checks.
- No workflows changed, no merges.

## EXACT_NEXT_ACTION
Check current upstream PR #2 head and parity gate, then run native `node --test tests/xml-cii-preview-per-build-cache.test.mjs tests/xml-cii-preview-strict-line-authority.test.mjs tests/xml-cii-preview-rating-authority.test.mjs tests/xml-cii-preview-wall-evidence-index.test.mjs tests/xml-cii-preview-wall-authority-parity.test.mjs tests/xml-cii-weight-match-preview-rating-snapshot.test.mjs` on stacked PR head. Run authorized BM2 Owner-config Chromium Preview and downstream EQUAL output checks vs base. If results differ STOP; otherwise obtain independent review. Do not merge without Owner approval.