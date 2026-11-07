// Engineering approval is NOT inferred from master-table confidence, DN,
// rating, equal-length matching, user-facing labels, or "preferred" ranking.
// This predicate is the common boundary for copying candidate mass into XML.
const finitePositive = value => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};
export function approvedPhysicalMassWeight(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  if (candidate.massAuthority !== 'APPROVED_SOURCE_MASS' ||
      candidate.engineeringMassApproved !== true ||
      candidate.acceptedForCii !== true ||
      candidate.inferredWeight === true ||
      candidate.fallbackSuggestion === true ||
      candidate.flangeWeightFallback === true ||
      candidate.zeroFallback === true ||
      candidate.specialFactorRule === true ||
      /interpolat|extrapolat|factor|fallback|infer|heuristic/i.test(
        String(candidate.weightMethod ?? candidate.method ?? ''))) return null;
  return finitePositive(candidate.selectedWeight ?? candidate.suggestedWeight ?? candidate.weight);
}
export function isApprovedPhysicalMassCandidate(candidate, displayedWeight = null) {
  const authorityWeight = approvedPhysicalMassWeight(candidate);
  if (authorityWeight === null) return false;
  if (displayedWeight === null || displayedWeight === undefined) return true;
  const display = finitePositive(displayedWeight);
  return display !== null && Math.abs(authorityWeight-display) <= 1e-9;
}
