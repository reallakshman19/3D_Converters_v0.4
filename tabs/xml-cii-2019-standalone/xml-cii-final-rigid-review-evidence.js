/**
 * Per-pointer review evidence. The source edge is the sole authority for
 * selecting a candidate ComponentRefNo. Operator choices are REVIEW-ONLY:
 * never promote catalog scores or manual weights into engineering mass approval.
 */
const clean = (value) => String(value ?? '').trim();
const finitePositive = (v) => clean(v) !== '' && Number.isFinite(Number(v)) && Number(v) > 0;
export function resolveFinalRigidOwnerSelection(context, input) {
  if (!input) return { selection: null, error: '' };
  const candidates = Array.isArray(context?.ownerCandidates) ? context.ownerCandidates : [];
  const index = Number(input.candidateIndex);
  const rationale = clean(input.rationale);
  if (!Number.isSafeInteger(index) || index < 0 || index >= candidates.length)
    return { selection: null, error: 'Selected physical owner is not a run-pinned source-edge candidate.' };
  if (rationale.length < 12)
    return { selection: null, error: 'Explain the physical-component ownership basis (at least 12 characters).' };
  const selected = candidates[index];
  if (!selected?.branchName || !selected.componentRefNo ||
      !['FROM','TO'].includes(selected.side) || !selected.sourceNode ||
      !Number.isFinite(Number(selected.sourceLengthMm)) || Number(selected.sourceLengthMm) <= 0)
    return { selection: null, error: 'Source-edge owner candidate has incomplete provenance.' };
  return { error: '', selection: {
    branchName: selected.branchName, componentRefNo: selected.componentRefNo,
    componentType: selected.componentType, sourceNode: selected.sourceNode,
    sourceNodeSide: selected.side, sourceLengthMm: selected.sourceLengthMm,
    rationale, authority: 'OPERATOR_SELECTED_SOURCE_CANDIDATE_REVIEW_ONLY',
  } };
}
/**
 * An operator-directed final RIGID edit is allowed as a QUARANTINED draft even
 * when physical ownership cannot be reconstructed. This is not an approval of
 * source component mass. The exact run's weightScale is required to use kg.
 */
export function qualifyFinalRigidManualReference(input, ownerResolution = null, options = {}) {
  if (!input) return { candidate: null, error: '' };
  const documentRef = clean(input.documentRef);
  const basis = clean(input.basis);
  const unit = clean(input.unit);
  const scale = Number(options.weightScale);
  if (!finitePositive(input.referenceWeight))
    return { candidate: null, error: 'Manual reference must be positive and finite.' };
  if (documentRef.length < 4 || basis.length < 12)
    return { candidate: null, error: 'Manual reference needs a source-document ID (4+ chars) and pointer-specific allocation basis (12+ chars).' };
  if (!['CII_OUTPUT_WEIGHT', 'SOURCE_KG'].includes(unit))
    return { candidate: null, error: 'Manual reference unit must be SOURCE_KG or CII_OUTPUT_WEIGHT.' };
  if (unit === 'SOURCE_KG' && (!Number.isFinite(scale) || ![1, 10].includes(scale)))
    return { candidate: null, error: 'Cannot convert kg to final CII units without a verified run-specific weight scale (×1 or ×10).' };
  const referenceWeight = unit === 'SOURCE_KG'
    ? Math.round(Number(input.referenceWeight) * scale * 1e8) / 1e8
    : Number(input.referenceWeight);
  if (!Number.isFinite(referenceWeight) || referenceWeight <= 0)
    return { candidate: null, error: 'Converted CII weight must be positive and finite.' };
  const sourceKg = unit === 'SOURCE_KG' ? Number(input.referenceWeight) : null;
  return { error: '', candidate: {
    referenceWeight, masterWeightKg: sourceKg, matchPct: null, rank: -1,
    title: 'Manual final RIGID correction', method: 'owner-directed-pointer-draft',
    source: documentRef, preferred: false, approximate: true, comparisonOnly: true,
    direct: false, manual: true,
    manualEvidence: { documentRef, basis, unit, sourceKg,
      weightScale: unit === 'SOURCE_KG' ? scale : null,
      convertedCiiWeight: referenceWeight, ownerResolution,
      engineeringMassApproval: 'NOT_ESTABLISHED',
    },
    basis: 'Operator-directed final RIGID correction from ' + documentRef +
      '; ' + basis + '; REVIEW-ONLY, original source mass and ownership unverified',
  } };
}
const isUnresolvedCode = (code) =>
  ['INVALID_POINTER','SHARED_POINTER','OWNER_SELECTION_REQUIRED',
    'OWNER_SELECTION_INVALID','PHYSICAL_OWNER_SHARED',
    'NO_SOURCE_OWNER','MISSING_REFERENCE','INVALID_MANUAL_REFERENCE'].includes(code);
export function summarizeFinalRigidBatch(plan, stagedPointers = []) {
  const rows = (plan?.proposals || []).filter((r) => r.status !== 'OUT_OF_SCOPE');
  const staged = new Set(stagedPointers);
  const skipRows = rows.filter((r) => r.status === 'SKIPPED_WITH_WARNING' ||
    r.status === 'ALREADY_EDITED');
  return {
    totalInScope: rows.length,
    corrected: rows.filter((r) => staged.has(r.pointer) && r.status === 'ELIGIBLE').length,
    unchanged: rows.filter((r) => r.status === 'BELOW_THRESHOLD' &&
      Number.isFinite(r.errorPct) && Math.abs(r.errorPct) <= 1e-9).length,
    belowThresholdOther: rows.filter((r) => r.status === 'BELOW_THRESHOLD' &&
      Number.isFinite(r.errorPct) && Math.abs(r.errorPct) > 1e-9).length,
    skipped: skipRows.length,
    unresolved: skipRows.filter((r) => isUnresolvedCode(r.skipCode)).length,
    reviewRequired: rows.filter((r) => r.status === 'REVIEW_ONLY').length,
    notSelected: rows.filter((r) => r.status === 'ELIGIBLE' && !staged.has(r.pointer)).length,
    warningRows: rows.filter((r) => r.warnings?.length).length,
    rows: rows.map((r) => ({
      rigidPointer: r.pointer, status: r.status, skipCode: r.skipCode || null,
      disposition: staged.has(r.pointer) && r.status === 'ELIGIBLE' ? 'CORRECTED_IN_REVIEW_DRAFT' :
        r.status === 'BELOW_THRESHOLD' && Math.abs(r.errorPct) <= 1e-9 ? 'NO_CHANGE_REQUIRED' :
          r.status === 'SKIPPED_WITH_WARNING' || r.status === 'ALREADY_EDITED'
            ? 'SKIPPED_WITH_WARNING' : r.status,
      originalWeight: r.originalWeight, proposedWeight: r.proposedWeight,
      errorPct: r.errorPct, warnings: r.warnings || [], reason: r.reason,
      ownerResolution: r.ownerResolution || null,
      referenceProvenance: r.candidate?.manualEvidence || null,
    })),
    engineeringMassApproval: 'NOT_ESTABLISHED_BY_BATCH_REVIEW',
  };
}
