import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_WEIGHT_MASTER_ROWS } from '../converters/xml-cii2019-core/default-weight-master-rows.js';
import { rankXmlCiiWeightCandidates } from '../converters/xml-cii2019-core/weight-valve-hints.js';
import { applyXmlCiiFlangeWeightFallbackToIssue } from '../converters/xml-cii2019-core/flange-weight-fallback.js';
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
  assert.equal(after.ranking.best?.engineeringMassApproved, false);
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
