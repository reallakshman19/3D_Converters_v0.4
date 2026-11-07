import { applyXmlCiiRigidWeightOverrides } from './weight-match-model.js';
import { isApprovedPhysicalMassCandidate } from './physical-mass-approval.js';

function text(value) { return value === undefined || value === null ? '' : String(value).trim(); }
function numberValue(value) { const numeric = Number(value); return Number.isFinite(numeric) ? numeric : null; }
function selectedWeight(candidate = {}) { return numberValue(candidate?.selectedWeight ?? candidate?.suggestedWeight ?? candidate?.weight); }
function bestCandidate(issue = {}) { return issue?.ranking?.best || (Array.isArray(issue?.candidates) ? issue.candidates[0] : null) || null; }
function candidateMethod(candidate = {}) { return text(candidate.weightMethod || candidate.method || candidate.semanticReason || candidate.typeDesc); }
function autoApplyReason(issue = {}, candidate = null) {
  // A source-mass authority record is required independently of a ranked
  // candidate, and all candidate writers share the same predicate.
  if (issue?.massAuthority !== 'APPROVED_SOURCE_MASS' ||
      candidate?.preferred !== true ||
      !isApprovedPhysicalMassCandidate(candidate, selectedWeight(candidate)))
    return '';
  return 'approved-source-mass';
}

export function collectXmlCiiAutoRigidWeightsFromIssues(issues = []) {
  const weightsByKey = {};
  const appliedRows = [];
  const remainingIssues = [];
  for (const issue of Array.isArray(issues) ? issues : []) {
    const candidate = bestCandidate(issue);
    const reason = autoApplyReason(issue, candidate);
    if (!reason) { remainingIssues.push(issue); continue; }
    const weight = selectedWeight(candidate);
    const key = text(issue?.key);
    if (!key || weight === null || weight <= 0) { remainingIssues.push(issue); continue; }
    weightsByKey[key] = weight;
    appliedRows.push({
      type: 'rigid-weight-auto-applied', branchName: issue.branchName || '', nodeNumber: issue.nodeNumber || '',
      componentType: issue.componentType || '', componentRefNo: issue.componentRefNo || '', boreMm: issue.boreMm,
      rating: issue.rating, lengthMm: issue.lengthMm, weight, method: reason,
      candidateType: candidate.type || candidate.valveType || '', candidateTypeDesc: candidate.typeDesc || '',
      weightMethod: candidate.weightMethod || '', lengthDelta: candidate.lengthDelta, semanticSource: candidate.semanticSource || '',
      semanticReason: candidate.semanticReason || '', message: `Auto-applied ${weight} kg from ${reason}.`,
    });
  }
  return { weightsByKey, appliedRows, remainingIssues, appliedCount: appliedRows.length };
}
export function applyXmlCiiAutoRigidWeightsFromIssues(xmlText, issues = []) {
  const plan = collectXmlCiiAutoRigidWeightsFromIssues(issues);
  if (!plan.appliedCount) return { xmlText, ...plan };
  const applied = applyXmlCiiRigidWeightOverrides(xmlText, plan.weightsByKey);
  return { ...plan, xmlText: applied.xmlText, appliedCount: applied.appliedCount, appliedRows: plan.appliedRows };
}
