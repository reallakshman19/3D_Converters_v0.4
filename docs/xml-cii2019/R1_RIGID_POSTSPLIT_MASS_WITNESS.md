# R1 — RIGID post-split mass witness (READ_ONLY / HOLD)

**Task:** XML-CII2019-RIGID-POSTSPLIT-MASS-WITNESS-R1-V04  
**Baseline:** `b856ddd01a66c0dbee8c519bfd0bd8118d1f3979`  
**Classification:** ENGINEERING_CRITICAL  
**Owner decision:** SALVAGE partial sidecar; production R1 qualification **HOLD**; R2 mass correction **NO-GO**.

This is an opt-in, after-the-fact *verification sidecar*, not a converter change. It reads source XML and, optionally, actual saved transformation snapshots, a separately approved physical-owner ledger, and emitted CII. It writes four JSON reports **only** under the explicit `--out` directory. It does not import the converter, reroute conversion, edit XML or CII, approve mass, redistribute weights, or infer physical ownership from `NodeNumber` or `ComponentRefNo`.

## Use with existing actual evidence

```bash
python tools/rigid_mass_witness_r1.py \
  --source /private/original-before-split.xml \
  --stage pre_python=/private/enriched-after-js.xml \
  --stage after_preprocess=/private/after-negative-renumber.xml \
  --cii /private/final.cii \
  --authority /private/approved-owners.json \
  --weight-scale 10 \
  --reference-cii /private/uninstrumented-baseline.cii \
  --out /private/fresh-r1-receipt-directory
```

Omit any stage not *actually* captured from the same effective run; do not manufacture events. `--weight-scale` must be the actual invocation scale, **not** assumed 10. Keep all private model, master, JSON, CII and owner-decision files local; never commit them. `--reference-cii` compares exact bytes; pointing to the same file does not yield a PASS.

The independently supplied authority file must use this structure; values here are examples only, not engineering approvals:

```json
{
  "sourceSha256": "<sha256 of original source XML>",
  "owners": [
    {
      "ownerId": "approved-physical-component-1",
      "sourceRecordKeys": ["B1:N2"],
      "approvedMassKg": "10",
      "expectedElementOrdinals": [1],
      "approvedDecisionId": "<reviewed physical decision>",
      "authorityBasis": "<independent engineering evidence>"
    }
  ]
}
```

The source record key combines source branch occurrence and *original source record ordinal*. Actual physical ownership, approved mass, and expected emitted element must be determined independently. The tool **never** turns an observed converter edge into physical authority.

## Outputs and qualification

* `source_lineage_witness.json`: SHA-bound original source record identities, raw weight states and any actual independently linked stage changes.
* `output_witness.json`: separately parsed CII CONTROL, 15-row ELEMENTS records, ELEMENT→RIGID pointers, RIGID weights and structural anomalies.
* `reconciliation_report.json`: per-approved-owner expected/emitted mass and placement, unknown/orphan mass, stage uncertainties, and byte-parity result.
* `run_receipt.json`: file digests, evidence statuses, and explicit converter-execution `NOT_RUN` (this tool does not execute conversion).

A per-owner synthetic numeric/placement match is **not** final real-component lineage. The reconciliation therefore retains `FINAL_ELEMENT_LINEAGE_UNVERIFIED` and cannot return overall PASS without future independently verified source-to-final-element evidence. Producer-inherited transformation events do not establish that authority.

## Reproduce synthetic checks

```bash
python -m unittest discover -s tests -p 'test_rigid_mass_witness_r1.py' -v
python -m py_compile tools/rigid_mass_witness_r1.py
```

**Local builder observation (6 Nov 2026):** 22/22 synthetic tests PASS; compile PASS; exact sidecar SHA-256 `e4a9d2087a2260fd35c6b109b0b61c40f9baeb2dcef5298f30a92ed834648b50`. These are locally executed tests, not a claim of GitHub CI or independent engineering qualification. Synthetic equal-total swapped-owner examples correctly produce two per-owner FAIL decisions while overall mass remains unchanged. Previously inspected public fixtures held 205 ELEMENT records, 57 RIGID records, and valid pointers; that is structural evidence, not mass proof.

## R1.1—R1.4 gated next steps (DO NOT START R2)

1. **R1.1 local custody first:** On Owner Windows checkout `D:\CodeD\v0.4`, read-only preserve+hash the existing 21-line JS dirty patch, full `git status` / `git diff --binary`, backups, R0 receipts and this sidecar. **No reset, restore, overwrite, or production edits.**
2. **R1.2 effective inputs:** capture exact original/enriched XML, staged JSON, imported masters, overrides, hydrated config, split flags, scale and execution arguments for Standalone and Model Converters. SHA-bind *actual bytes*. Private inputs stay local.
3. **R1.3 source→output:** reuse `tests/glrd_xmlcii_external_reference.py` for the Standalone controlled Node 460 reference; do not misrepresent it as an authentic approved GLRD mass. Capture both routes' renumbered, absorbed, dropped and retained identities, and independently parse their CII ELEMENTS/RIGID pointers. Inspect `_merge_nodes` representative retention and identify the first observable physical-owner divergence.
4. **R1.4 qualify:** compare untouched baseline and local candidate with identical effective inputs, exact unaffected CII byte parity and separately approved physical-owner decisions. Require independent engineering-critical review before R1 completion. Unknown identity is `OWNER_UNPROVEN`, **never PASS**.

**NOT_RUN / BLOCKING:** Local Windows R0 custody; actual Standalone and Model Converters native GLRD runs; source-to-final-edge lineage; authentic physical-owner approval; paired real CII byte parity; independent review.

**Safety invariant:** No production converter source, mass redistribution, topology, writer, UI, numerical policy, masters, private GLRD payload, or defaults are changed in this PR.
