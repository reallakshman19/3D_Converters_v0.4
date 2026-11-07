# PR4 — R1 rigid post-split mass witness recovery report

**Task:** XML-CII2019-RIGID-POSTSPLIT-MASS-WITNESS-R1-V04  
**Decision:** SALVAGE_PARTIAL · R1 HOLD · R2 NO-GO  
**Baseline SHA:** b856ddd01a66c0dbee8c519bfd0bd8118d1f3979  
**Branch:** feat/xml-cii-r1-rigid-postsplit-witness-20261106  
**PR:** https://github.com/reallakshman19/3D_Converters_v0.4/pull/4 (DRAFT, HOLD).  
**Authority:** tool-only, opt-in, read-only. No converter production edits, no local Windows checkout access, no merge.

## Recovery facts

1. Full original sidecar source and 22 synthetic tests were recovered from the local R1 partial package and rerun on 6 Nov 2026: **22/22 PASS**; `py_compile` PASS. Sidecar SHA-256: `e4a9d2087a2260fd35c6b109b0b61c40f9baeb2dcef5298f30a92ed834648b50`. Git blob hashes must match original local code/test files.
2. The external R1 witness is deliberately unable to prove producer transformation→final ELEMENT lineage. It does not issue overall PASS merely from matching approved synthetic mass.
3. Source inspection isolates a risk: `xml_to_cii2019_contracted_direction.py::_merge_nodes` retains representative weight and merges name/restraints, not absorbed weight. This is a potential mass-custody break, **not** an observed real GLRD loss.
4. Physical owner must be approved independently of `ComponentRefNo`, `NodeNumber` and CII output. Equal global mass with swapped per-owner assignment is an adversarial FAIL.
5. Two active PRs #2 and #3 relate to Preview performance, not this read-only witness. No exact touched-file overlap was observed.
6. The attached private GLRD benchmark archive is **NOT** published to GitHub; only test-generated synthetic evidence is used.

## Changed-file ledger

* `tools/rigid_mass_witness_r1.py`: new standalone read-only source/independent CII/reconciliation CLI.
* `tests/test_rigid_mass_witness_r1.py`: new synthetic adversarial tests.
* `docs/xml-cii2019/R1_RIGID_POSTSPLIT_MASS_WITNESS.md`: safety, CLI, inputs, gates and next actions.
* `agents/PR4_workreport.md`: durable recovery ledger.

No existing production modules or tests are edited.

## Validation ledger

| Check | Status | Observation | Authority/limit |
| --- | --- | --- | --- |
| Baseline GitHub main exact SHA | PASS | connected GitHub inspection, 6 Nov | remote metadata |
| Sidecar byte identity | PASS | Git blob SHA vs `git hash-object` local file | content-custody comparison |
| Synthetic unit tests | PASS | local Python 22/22 | synthetic only, not independent owner approval |
| Sidecar compile | PASS | local py_compile | syntax only |
| Public output pointer structural census | PASS (reported prior) | four public fixture parse: 205 elements / 57 rigids | structural only |
| Windows patch, backups, R0 receipts | NOT_RUN | checkout inaccessible | BLOCKING |
| Standalone authentic effective-input replay | NOT_RUN | missing Windows run context | BLOCKING |
| Model Converters authentic effective-input replay | NOT_RUN | missing Windows run context | BLOCKING |
| Physical owner→final edge proof | NOT_RUN | transformation receipts incomplete | BLOCKING |
| Real before/after CII bytes | NOT_RUN | no same-input paired real outputs | BLOCKING |
| Independent review | NOT_RUN | separate reviewer not yet assigned | BLOCKING |
| R2 redistribution | NOT_APPLICABLE | not authorized | NO-GO |

## Highest engineering risk and falsifier

Potential first custody divergence at negative-node renumbering and contraction where absorbed-node weight may vanish from observable retained nodes; explicit real source and converted final-edge witnesses could confirm or falsify. Numerical equality of total RIGID weights is not a sufficient falsifier. Do not invent approval from converter output.

## EXACT_NEXT_ACTION

On Owner checkout `D:\CodeD\v0.4`, a local-access agent must read-only capture SHA-256-bound **existing dirty 21-line patch**, complete git status/diff, backups, R0 receipts, and both actual routes' effective source/enriched XML, JSON, masters, overrides, split/scale/config/CLI. Keep private bytes local. Then reuse existing GLRD harness + this sidecar to trace actual source→transformation→final ELEMENT/RIGID and seek independent review. **No R2.**
