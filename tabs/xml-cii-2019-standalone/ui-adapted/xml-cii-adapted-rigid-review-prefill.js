// Rigid review UI proposals are not source-mass approval. A proposed estimate
// must be independently reviewed before the popup may create an XML override.
import { isApprovedPhysicalMassCandidate } from '../../../converters/xml-cii2019-core/physical-mass-approval.js';
import { classifyWeightMasterCandidate } from '../../../converters/xml-cii2019-core/weight-valve-hints.js';

const name = value => String(value ?? '').trim();
const positive = value => {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null;
};
function family(issue) {
  const type = name(issue?.componentType).toUpperCase();
  if (type === 'PCOM' || type === 'UNKNOWN' || name(issue?.reviewCategory).toUpperCase() === 'UNKNOWN')
    return 'UNKNOWN';
  if (type.startsWith('FLAN')) return 'FLANGE';
  if (type.startsWith('VALV') || type === 'VLV') return 'VALVE';
  const identity = classifyWeightMasterCandidate({
    typeDesc: [issue?.dtxr,issue?.nodeName].map(name).join(' '),
  });
  return identity.family || '';
}
function sourceQualified(candidate, issue, wanted) {
  const cls = candidate?.candidateClass?.family ||
    classifyWeightMasterCandidate(candidate).family;
  if (!cls || cls !== wanted) return false;
  // Do not transform a generic same-bore/rating fallback into a family match.
  if (!name(candidate?.typeDesc) || /same\s+bore\s*\/\s*rating/i.test(name(candidate.typeDesc))) return false;
  if (candidate?.zeroFallback) return false;
  if (candidate.rowBore != null && Number.isFinite(Number(issue.boreMm)) &&
      Math.abs(Number(candidate.rowBore)-Number(issue.boreMm)) >= 1) return false;
  const rating = value => name(value).replace(/#/g,'').replace(/\s+/g,'').toUpperCase();
  if (candidate.rowRating && rating(issue.rating) && rating(candidate.rowRating) !== rating(issue.rating)) return false;
  if (candidate.rejectedReason && !candidate.lengthQualified && !candidate.inferredWeight) return false;
  return true;
}

// The engine can classify an OLET/TEE as a keyword-related valve, but those
// connection components do not become physical rigid masses. Keep the popup
// scope aligned with the Weight Match UI; do not alter native topology.
export function isRigidWeightReviewEligibleIssue(issue) {
  const type=name(issue?.componentType).toUpperCase();
  return type==='RIGID' || type==='PCOM' || type==='VLV' ||
    type.startsWith('FLAN') || type.startsWith('VALV') ||
    type.startsWith('INST');
}

export function proposedRigidReviewWeight(issue) {
  if (!issue || issue.mapped) return null;
  const expected = family(issue);
  const candidates = Array.isArray(issue.candidates) ? issue.candidates : [];
  // Provenance-verified source masses can be selected independently of the
  // empirical/length rule; the predicate is the same one used by the writer.
  for (const candidate of candidates) {
    const weight = positive(candidate.selectedWeight ?? candidate.suggestedWeight ?? candidate.weight);
    if (weight !== null && isApprovedPhysicalMassCandidate(candidate, weight))
      return { weight, approved: true, reference: name(candidate.typeDesc || candidate.referenceFamily || 'Approved source mass'), method:'approved-source' };
  }
  if (expected === 'UNKNOWN' || (!expected && name(issue.componentType).toUpperCase() === 'RIGID')) {
    const unknown = issue.unknownComponentSuggestion;
    const trustedLength = ['component-ref-endpoint-span','ElementLengthMm'].includes(name(issue.elementLengthSource));
    const weight = positive(unknown?.suggestedKg);
    return unknown?.ok === true && trustedLength && weight !== null
      ? { weight, approved: false, reference: name(unknown.referenceFamily || 'Unknown length rule'), method:'unknown-length-advisory' }
      : null;
  }
  if (!['VALVE','FLANGE','BLIND'].includes(expected)) return null;
  // Length-derived mass on a CII forward route is not physical-component mass.
  if (!['component-ref-endpoint-span','ElementLengthMm'].includes(name(issue.elementLengthSource))) return null;
  for (const candidate of candidates) {
    const weight = positive(candidate.selectedWeight ?? candidate.suggestedWeight ?? candidate.weight);
    if (weight === null || !sourceQualified(candidate,issue,expected)) continue;
    return {weight,approved:false,reference:name(candidate.typeDesc || candidate.type),method:name(candidate.weightMethod || 'catalog-advisory')};
  }
  return null;
}

export function stageRigidReviewProposal(input, proposal) {
  if (!input || !proposal) return false;
  const weight = positive(proposal.weight);
  if (weight === null) return false;
  input.value = String(weight);
  input.dataset.rigidSuggestionDraft = proposal.approved ? 'approved' : 'estimate';
  input.dataset.rigidSuggestionReference = name(proposal.reference);
  // A new proposal invalidates any previous individual or bulk approval.
  delete input.dataset.rigidReviewMethod;
  input.title = proposal.approved
    ? 'Approved source mass selected: ' + name(proposal.reference)
    : 'SUGGESTION DRAFT ONLY — verify this physical-component mass before Apply: ' + name(proposal.reference);
  input.style.borderColor = proposal.approved ? '#10b981' : '#d9a441';
  const verified = input.closest('tr')?.querySelector('[data-rigid-suggestion-verified]');
  if (verified) { verified.checked = false; verified.disabled = Boolean(proposal.approved); }
  return true;
}
export function clearRigidReviewProposal(input) {
  if (!input) return;
  delete input.dataset.rigidSuggestionDraft;
  delete input.dataset.rigidSuggestionReference;
  delete input.dataset.rigidReviewMethod;
  input.title = '';
  input.style.borderColor = '';
  const verified = input.closest('tr')?.querySelector('[data-rigid-suggestion-verified]');
  if (verified) { verified.checked = false; verified.disabled = false; }
}
export function rigidReviewProposalNeedsVerification(input) {
  if(input?.dataset?.rigidSuggestionDraft !== 'estimate')return false;
  // Legacy single/ATTA review still has an individual Reviewed checkbox.
  // Consolidated review deliberately has NO per-row qualification checkbox:
  // the only accepted route is a separate explicit batch attestation.
  const rowCheckbox=input.closest('tr')?.querySelector('[data-rigid-suggestion-verified]');
  if(rowCheckbox)return rowCheckbox.checked !== true;
  return input.dataset.rigidReviewMethod !== 'EXPLICIT_BULK_OWNER_ATTESTATION';
}
