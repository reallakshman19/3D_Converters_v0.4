/**
 * Read-only batch planning. Never writes a RIGID mass. Selection is an
 * explicit, per-pointer user decision. The output is consumed by the existing
 * RIGID.weight transaction/preview/reparse/byte-parity verifier.
 */
import { finalRigidWeightErrorPercent } from './xml-cii-final-rigid-weight-error.js';
import {
  resolveFinalRigidOwnerSelection, qualifyFinalRigidManualReference,
} from './xml-cii-final-rigid-review-evidence.js';

const valid = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const keyOf = (mapping) => mapping?.componentRefNo
  ? JSON.stringify([mapping.branchName, mapping.componentRefNo]) : '';
// Source-context disagreement is warning evidence, not physical mass approval.
const sourceMetadataWarnings = (context) => {
  if (!context) return [];
  const codes = [...(Array.isArray(context.conflicts) ? context.conflicts : [])];
  if (context.bore?.conflict) codes.push('BORE_CONFLICT');
  if (context.rating?.conflict) codes.push('RATING_CONFLICT');
  if (context.dtxr?.suppressed) codes.push('DTXR_SUPPRESSED' +
    (context.dtxr.suppressionReason ? ': ' + String(context.dtxr.suppressionReason) : ''));
  if (context.status === 'CONFLICT_REVIEW' && !codes.length)
    codes.push('SOURCE_CONTEXT_CONFLICT_REVIEW');
  return [...new Set(codes.map(String))];
};
const selectedCandidate = (plan, selectedIndex) => {
  const options = plan?.nearestSuggestions || [];
  const index = Number.isInteger(selectedIndex) && selectedIndex >= 0
    ? selectedIndex : 0;
  return { candidate: options[index] || null, index };
};

/**
 * options: thresholdPct (default 40, strict >), includeReviewOnly (default
 * false), scope ('all'|'filtered'|'selected'), visiblePointers,
 * selectedPointers, currentEditedValues (Map), selectedIndices (Map),
 * ownerSelections (Map), manualReferences (Map).
 * Never confuse catalog match % with weight deviation %.
 */
export function planFinalRigidBatchCorrections(inventory, plans, options = {}) {
  const threshold = options.thresholdPct === undefined ? 40 : Number(options.thresholdPct);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100000)
    throw new Error('Batch threshold must be a valid percentage from 0 to 100000.');
  const scope = options.scope || 'all';
  if (!['all', 'filtered', 'selected'].includes(scope))
    throw new Error('Unrecognized batch scope.');
  const visible = new Set(options.visiblePointers || []);
  const selected = new Set(options.selectedPointers || []);
  const edited = options.currentEditedValues || new Map();
  const indices = options.selectedIndices || new Map();
  const ownerSelections = options.ownerSelections || new Map();
  const manualReferences = options.manualReferences || new Map();
  const rows = Array.isArray(inventory?.rows) ? inventory.rows : [];
  const ownerCounts = new Map();
  for (const row of rows) {
    const k = keyOf(plans?.[row.rigidPointer - 1]?.mapping);
    if (k) ownerCounts.set(k, (ownerCounts.get(k) || 0) + 1);
  }

  const proposals = rows.map((row) => {
    const pointer = row.rigidPointer;
    const plan = plans?.[pointer - 1];
    const context = plan?.sourceContext;
    const ownerInput = ownerSelections.get(pointer);
    const ownerReview = resolveFinalRigidOwnerSelection(context, ownerInput);
    const manualInput = manualReferences.get(pointer);
    const manual = qualifyFinalRigidManualReference(manualInput, ownerReview.selection);
    const warnings = sourceMetadataWarnings(context);
    if (!plan?.mapping && !ownerReview.selection) warnings.push('SOURCE_OWNER_UNVERIFIED');
    if (ownerReview.selection) warnings.push('EXPLICIT_OWNER_SELECTION_REVIEW_ONLY');
    if (manual.candidate) warnings.push('MANUAL_REFERENCE_REVIEW_ONLY');
    const warningText = () => warnings.length ? ' Source warnings: ' + [...new Set(warnings)].join('; ') + '.' : '';
    const base = {
      pointer, originalWeight: Number(row.weight), candidateIndex: -1,
      proposedWeight: null, errorPct: null, status: 'SKIPPED_WITH_WARNING',
      reviewRequired: false, candidate: null, reason: '', warnings,
      ownerResolution: ownerReview.selection, skipCode: null,
    };
    const skip = (code, reason) => ({ ...base, status: 'SKIPPED_WITH_WARNING',
      skipCode: code, reason: reason + warningText() });
    if (scope === 'filtered' && !visible.has(pointer) ||
      scope === 'selected' && !selected.has(pointer))
      return { ...base, status: 'OUT_OF_SCOPE', reason: 'Outside selected batch scope.' };
    if (!plan || !Array.isArray(row.linkedElements) || row.linkedElements.length !== 1)
      return skip('INVALID_POINTER', 'Final RIGID must reference exactly one CII ELEMENTS record.');
    if (row.status === 'SHARED_POINTER' || row.status === 'UNREFERENCED')
      return skip('SHARED_POINTER', 'Shared/unreferenced RIGID cannot be edited through one pointer.');
    if (ownerReview.error) return skip('OWNER_SELECTION_INVALID', ownerReview.error);
    if (manual.error) return skip('INVALID_MANUAL_REFERENCE', manual.error);
    // Competing physical owners must be resolved from the *actual source edge*.
    const competingRefs = new Set((context?.ownerCandidates || [])
      .map((c) => c.componentRefNo).filter(Boolean));
    if (competingRefs.size > 1 && !ownerReview.selection)
      return skip('OWNER_SELECTION_REQUIRED',
        'Multiple source ComponentRefNos own this edge; select one and document why.');
    // Shared-owner mass cannot be duplicated across final pointers. Permit
    // only a pointer-local manual allocation with exact-edge owner evidence;
    // this remains review-only, never release authority.
    if (plan.mapping && (ownerCounts.get(keyOf(plan.mapping)) || 0) > 1 &&
        !(ownerReview.selection && manual.candidate))
      return skip('PHYSICAL_OWNER_SHARED',
        'Multiple final RIGIDs share one ComponentRefNo; enter a reviewed, pointer-local allocation.');
    if (!Number.isFinite(Number(row.weight)) || Number(row.weight) < 0)
      return skip('INVALID_SOURCE_WEIGHT', 'Original final CII weight is not nonnegative and finite.');
    const current = edited.get(pointer);
    if (current !== undefined && String(current).trim() !== String(row.rawWeight).trim())
      return { ...base, status: 'ALREADY_EDITED', skipCode: 'EXISTING_EDIT',
        reason: 'Already modified; preserve the existing manual edit.' };
    const { candidate, index } = manual.candidate
      ? { candidate: manual.candidate, index: -1 }
      : selectedCandidate(plan, indices.get(pointer));
    if (!candidate || !valid(candidate.referenceWeight))
      return skip('MISSING_REFERENCE', 'No positive qualified catalog or documented manual reference.');
    if (candidate.approximate || candidate.comparisonOnly)
      warnings.push('PROVISIONAL_REFERENCE_REVIEW_ONLY');
    const expected = Number(candidate.referenceWeight);
    const error = finalRigidWeightErrorPercent(Number(row.weight), expected);
    if (error === null)
      return skip('INVALID_REFERENCE_COMPARISON',
        'Cannot calculate valid error in final CII output units.');
    const full = {
      ...base, candidateIndex: index, candidate, proposedWeight: expected,
      // A trusted exact candidate from the existing component-verified
      // reference planner can be staged by explicit row selection. Mode A
      // comparison-only candidates, approximate weights and unverified owner
      // matches MUST require separate review opt-in + acknowledgement.
      errorPct: error, reviewRequired: !(
        Boolean(plan.mapping) && context?.status === 'VERIFIED' &&
        candidate.direct === true && candidate.approximate !== true &&
        candidate.comparisonOnly !== true && !candidate.manual &&
        !ownerReview.selection && warnings.length === 0
      ),
    };
    if (Math.abs(error) <= threshold)
      return { ...full, status: 'BELOW_THRESHOLD',
        disposition: Math.abs(error) <= 1e-9 ? 'NO_CHANGE_REQUIRED' : 'BELOW_THRESHOLD',
        reason: Math.abs(error) <= 1e-9 ? 'No numerical correction required.' + warningText()
          : 'Absolute error does not exceed ±' + threshold + '%.' + warningText() };
    if (full.reviewRequired && !options.includeReviewOnly)
      return { ...full, status: 'REVIEW_ONLY',
        reason: 'Advisory suggestion / source warnings require explicit review opt-in and per-row approval.' + warningText() };
    return { ...full, status: 'ELIGIBLE', reason: full.reviewRequired
      ? 'REVIEW: source basis is not a verified physical mass. Explicit row approval required.' + warningText()
      : 'Exact candidate available. Confirm this row before staging.' };
  });
  return {
    thresholdPct: threshold, scope, includeReviewOnly: Boolean(options.includeReviewOnly),
    proposals, eligible: proposals.filter((r) => r.status === 'ELIGIBLE'),
    held: proposals.filter((r) => r.status === 'SKIPPED_WITH_WARNING' || r.status === 'REVIEW_ONLY'),
    skipped: proposals.filter((r) => r.status === 'SKIPPED_WITH_WARNING' ||
      r.status === 'ALREADY_EDITED'),
    belowThreshold: proposals.filter((r) => r.status === 'BELOW_THRESHOLD'),
  };
}

/**
 * Prepare a nearest-candidate SELECTION, not a mass approval or edit.
 * In the batch dialog the operator intentionally requested every nearest
 * proposal; includeReviewOnly enables PROVISIONAL candidates for selection,
 * but the independent review acknowledgement and Stage/Verify are separate.
 *
 * Structural/ownership holds, existing manual edits, threshold-excluded rows
 * and out-of-scope pointers are never selected. Metadata warnings require
 * review opt-in and acknowledgement. Do not change original RIGID weights.
 */
export function planAllNearestBatchDraftSelection(inventory, plans, options = {}) {
  const candidateIndices = new Map(options.selectedIndices || []);
  const scope = options.scope || 'all';
  const visible = new Set(options.visiblePointers || []);
  const selected = new Set(options.selectedPointers || []);
  const rows = Array.isArray(inventory?.rows) ? inventory.rows : [];
  for (const row of rows) {
    const pointer = row.rigidPointer;
    if (scope === 'filtered' && !visible.has(pointer) ||
        scope === 'selected' && !selected.has(pointer)) continue;
    if (plans?.[pointer - 1]?.nearestSuggestions?.length) {
      candidateIndices.set(pointer, 0);
    }
  }
  const planned = planFinalRigidBatchCorrections(inventory, plans, {
    ...options,
    selectedIndices: candidateIndices,
    includeReviewOnly: true,
  });
  return {
    candidateIndices,
    includeReviewOnly: true,
    selectedPointers: planned.eligible.map((row) => row.pointer),
    reviewRequired: planned.eligible.filter((row) => row.reviewRequired).length,
    hardHeld: planned.proposals.filter((row) =>
      row.status === 'SKIPPED_WITH_WARNING' || row.status === 'ALREADY_EDITED').length,
    belowThreshold: planned.belowThreshold.length,
    plan: planned,
  };
}
