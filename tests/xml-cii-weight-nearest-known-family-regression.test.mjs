import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_WEIGHT_MASTER_ROWS } from '../converters/xml-cii2019-core/default-weight-master-rows.js';
import { rankXmlCiiWeightCandidates } from '../converters/xml-cii2019-core/weight-valve-hints.js';
import { applyXmlCiiFlangeWeightFallbackToIssue } from '../converters/xml-cii2019-core/flange-weight-fallback.js';
import { modeARigidCandidateMarkup } from '../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a.js';
import { isSingleOrAttaRigidReviewDialog } from '../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-smart-fill-ui.js';
import { isApprovedPhysicalMassCandidate } from '../converters/xml-cii2019-core/physical-mass-approval.js';

const config = { weight: { masterRows: DEFAULT_WEIGHT_MASTER_ROWS } };

function rankedIssue(extra = {}) {
  const input = {
    componentType: 'RIGID', reviewCategory: 'RIGID',
    componentRefNo: '=TEST/1', nodeName: '', dtxr: '',
    boreMm: 50, rating: 900, lengthMm: 109,
    elementLengthSource: 'component-ref-endpoint-span',
    mapped: false, weight: 0, overrideWeight: 0,
    ...extra,
  };
  const ranking = rankXmlCiiWeightCandidates(input, config, { includeRejected: true });
  return { ...input, ranking, candidates: ranking.candidates.slice(0, 5),
    rejectedCandidates: ranking.rejectedCandidates.slice(0, 3) };
}

test('recognized RIGID welding-neck flange retains the actual original master ranking', () => {
  const before = rankedIssue({ dtxr: 'WELDING NECK FLANGE SCH 80S 900#' });
  assert.ok(before.ranking.best, 'real master must supply a ranked candidate');
  const after = applyXmlCiiFlangeWeightFallbackToIssue(before, config);
  assert.deepEqual(after.candidates, before.candidates);
  assert.deepEqual(after.ranking, before.ranking);
  assert.equal(after.unknownComponentSuggestion, undefined);
  assert.equal(after.massSuggestionOnly, undefined);
  assert.equal(isApprovedPhysicalMassCandidate(after.ranking.best), false,
    'master ranking is still not engineering-mass approval');
});

test('recognized RIGID trunnion valve never becomes generic reduced-bore Unknown', () => {
  const before = rankedIssue({ dtxr: 'VALVE TRUNN FB FLGD 900#', lengthMm: 610 });
  const after = applyXmlCiiFlangeWeightFallbackToIssue(before, config);
  assert.deepEqual(after.candidates, before.candidates);
  assert.deepEqual(after.rejectedCandidates, before.rejectedCandidates);
  assert.equal(after.unknownComponentSuggestion, undefined);
});

test('explicit FLAN, VALV, INST preserve their ranked candidates without DTXR', () => {
  for (const componentType of ['FLAN', 'VALV', 'INST']) {
    const before = rankedIssue({ componentType, reviewCategory: componentType });
    const after = applyXmlCiiFlangeWeightFallbackToIssue(before, config);
    assert.deepEqual(after.candidates, before.candidates, componentType);
    assert.equal(after.unknownComponentSuggestion, undefined, componentType);
  }
});

test('known family removes stale Unknown sidecar on an old cached row', () => {
  const before = rankedIssue({ componentType: 'FLAN',
    unknownComponentSuggestion: { ok: true, suggestedKg: 999 },
    massSuggestionOnly: true, massSuggestionHold: true });
  const after = applyXmlCiiFlangeWeightFallbackToIssue(before, config);
  assert.deepEqual(after.candidates, before.candidates);
  assert.equal(after.unknownComponentSuggestion, undefined);
  assert.equal(after.massSuggestionOnly, undefined);
  assert.equal(after.massSuggestionHold, undefined);
});

test('source PCOM always routes to Unknown, even if text names a known valve', () => {
  const before = rankedIssue({ componentType: 'PCOM', reviewCategory: 'UNKNOWN',
    dtxr: 'VALVE TRUNN FB FLGD 900#', lengthMm: 19.1 });
  const after = applyXmlCiiFlangeWeightFallbackToIssue(before, config);
  assert.equal(after.unknownComponentSuggestion?.referenceFamily, 'Weldneck Flange');
  assert.equal(after.unknownComponentSuggestion?.suggestedKg, 2.628);
  assert.equal(after.massSuggestionOnly, true);
  assert.equal(after.ranking.best, null, '19.1/109 is outside ranked fallback ratio; sidecar remains advisory only');
  assert.equal(isApprovedPhysicalMassCandidate(after.ranking.best), false);
});

test('genuinely unclassified RIGID retains PR #8 length selector and boundary', () => {
  const before = rankedIssue({ componentRefNo: '=TEST/UNKNOWN', lengthMm: 115 });
  const after = applyXmlCiiFlangeWeightFallbackToIssue(before, config);
  assert.equal(after.unknownComponentSuggestion?.suggestedKg, 15);
  assert.equal(after.unknownComponentSuggestion?.atFlangeToleranceBoundary, true);
  assert.equal(after.ranking.best?.preferred, false);
  assert.equal(isApprovedPhysicalMassCandidate(after.ranking.best), false);
});

test('unknown route-only length remains held, not a synthesized mass', () => {
  const before = rankedIssue({componentType: 'PCOM', reviewCategory: 'UNKNOWN',
    lengthMm: 763.4, elementLengthSource: 'computed-forward'});
  const after = applyXmlCiiFlangeWeightFallbackToIssue(before, config);
  assert.deepEqual(after.candidates, []);
  assert.equal(after.ranking.best, null);
  assert.equal(after.massSuggestionHold, true);
});

test('single/ATTA dashboard must not attach to a consolidated nine-column Mode A dialog', () => {
  const normal = { querySelector: sel =>
    sel === '.mc-rigid-review-input[data-rigid-review-key]' ? {} : null };
  const modeA = { querySelector: sel =>
    sel === '[data-mode-a-rigid-body]' ? {} : null };
  const mixed = { querySelector: sel =>
    ['.mc-rigid-review-input[data-rigid-review-key]', '[data-mode-a-rigid-body]'].includes(sel) ? {} : null };
  assert.equal(isSingleOrAttaRigidReviewDialog(normal), true);
  assert.equal(isSingleOrAttaRigidReviewDialog(modeA), false);
  assert.equal(isSingleOrAttaRigidReviewDialog(mixed), false);
  assert.equal(isSingleOrAttaRigidReviewDialog(null), false);
});

test('Mode A known flange shows ranked source family and method, never clickable estimate', () => {
  const before = rankedIssue({ dtxr: 'WELDING NECK FLANGE SCH 80S 900#', componentType: 'RIGID' });
  const after = applyXmlCiiFlangeWeightFallbackToIssue(before, config);
  const markup = modeARigidCandidateMarkup(after, 0);
  assert.match(markup, /data-mode-a-rigid-advisory/);
  assert.match(markup, /Weldneck Flange/);
  assert.match(markup, /advisory only/);
  assert.doesNotMatch(markup, /data-mode-a-rigid-candidate=/);
  assert.doesNotMatch(markup, /data-mode-a-unknown-weight-suggestion/);
});

test('Mode A PCOM Unknown displays one passive length-rule sidecar instead of legacy ranking', () => {
  const before = rankedIssue({ componentType: 'PCOM', reviewCategory: 'UNKNOWN',
    dtxr: 'VALVE TRUNN FB FLGD 900#', lengthMm: 19.1 });
  const after = applyXmlCiiFlangeWeightFallbackToIssue(before, config);
  const markup = modeARigidCandidateMarkup(after, 0);
  assert.equal((markup.match(/data-mode-a-unknown-weight-suggestion/g) || []).length, 1);
  assert.match(markup, /Weldneck Flange/);
  assert.match(markup, /2\.628 kg/);
  assert.doesNotMatch(markup, /data-mode-a-rigid-candidate=/);
});

test('Mode A approved source mass remains the only clickable candidate', () => {
  const base = { candidates: [{ weight: 15, selectedWeight: 15,
    massAuthority: 'APPROVED_SOURCE_MASS', engineeringMassApproved: true,
    acceptedForCii: true, preferred: true, weightMethod: 'source-verified' }] };
  const approved = modeARigidCandidateMarkup(base, 2);
  assert.match(approved, /data-mode-a-rigid-approved="true"/);
  assert.match(approved, /data-mode-a-rigid-candidate="2"/);
  const unapproved = modeARigidCandidateMarkup({ ...base,
    candidates: [{ ...base.candidates[0], acceptedForCii: false }] }, 2);
  assert.match(unapproved, /data-mode-a-rigid-advisory/);
  assert.doesNotMatch(unapproved, /data-mode-a-rigid-candidate=/);
});
