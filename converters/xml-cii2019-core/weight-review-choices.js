// Shared, display-only choices for Weight Match and consolidated rigid review.
// A catalog row never becomes an approved physical-component mass through UI
// preloading, candidate ranking, or a percentage/length-match score.
import { isApprovedPhysicalMassCandidate } from './physical-mass-approval.js';

const name = value => String(value ?? '').trim();
const positive = value => {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function availableWeightReviewChoices(issue = {}) {
  if (issue?.sourceBoreHold) return [];
  const choices = [], seen = new Set();
  const add = (candidate, rejected = false) => {
    const weight = positive(candidate?.selectedWeight ?? candidate?.suggestedWeight ?? candidate?.weight);
    if (weight === null || candidate?.zeroFallback) return;
    const family = name(candidate?.referenceFamily || candidate?.typeDesc ||
      candidate?.valveType || candidate?.type || 'Master reference');
    const length = Number(candidate?.rowLength);
    const delta = Number(candidate?.lengthDelta);
    const key = [weight, family.toUpperCase(), Number.isFinite(length) ? length : '', rejected].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    choices.push({
      weight, family,
      referenceLengthMm: Number.isFinite(length) && length > 0 ? length : null,
      lengthDeltaMm: Number.isFinite(delta) ? delta : null,
      rejected,
      approved: !rejected && isApprovedPhysicalMassCandidate(candidate, weight),
      reason: rejected ? name(candidate?.rejectedReason || 'Outside exact length tolerance')
        : name(candidate?.weightWarning || candidate?.weightMethod || 'master candidate'),
    });
  };
  if (!issue?.massSuggestionOnly) {
    for (const candidate of issue?.candidates || []) add(candidate);
    // A mismatched reference is visible as a DIFFERENT physical-length option,
    // not as an exact approved suggestion. Explicit Reviewed action is required.
    for (const candidate of issue?.rejectedCandidates || []) add(candidate, true);
  }
  const u = issue?.unknownComponentSuggestion;
  if (u?.ok && positive(u.suggestedKg) !== null) {
    const weight = positive(u.suggestedKg);
    const family = name(u.referenceFamily || 'Unknown physical length');
    const key = [weight, family.toUpperCase(), '', false].join('|');
    if (!seen.has(key)) choices.push({
      weight, family, referenceLengthMm: positive(u.referenceLengthMm),
      lengthDeltaMm: null, rejected: false, approved: false,
      reason: 'Unknown component length-rule estimate; review only',
    });
  }
  return choices;
}

export function preferredWeightReviewDraft(issue) {
  const choices = availableWeightReviewChoices(issue);
  // Rejected length matches can be inspected and selected explicitly, but must
  // NEVER be prepopulated as though they passed the physical-length gate.
  return choices.find(choice => !choice.rejected) || null;
}

export function weightReviewChoiceLabel(choice) {
  const length = choice.referenceLengthMm === null ? '' : ' · master L=' + choice.referenceLengthMm + 'mm';
  const delta = choice.lengthDeltaMm === null ? '' : ' · Δ' + choice.lengthDeltaMm + 'mm';
  return choice.weight + ' kg · ' + choice.family + length + delta +
    (choice.rejected ? ' · LENGTH MISMATCH / REVIEW' : choice.approved ? ' · approved source' : ' · estimate');
}
