import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {DEFAULT_WEIGHT_MASTER_ROWS} from '../converters/xml-cii2019-core/default-weight-master-rows.js';
import {rankXmlCiiWeightCandidates} from '../converters/xml-cii2019-core/weight-valve-hints.js';
import {applyXmlCiiFlangeWeightFallbackToIssue} from '../converters/xml-cii2019-core/flange-weight-fallback.js';
import {collectXmlCiiAutoRigidWeightsFromIssues}
  from '../converters/xml-cii2019-core/rigid-weight-auto-apply.js';

function issue(lengthMm,extra={}) {
  const config={weight:{masterRows:DEFAULT_WEIGHT_MASTER_ROWS}};
  const props={key:'B1::10020',branchName:'B1',nodeNumber:'10020',
    boreMm:50,rating:900,componentType:'RIGID',componentRefNo:'=TEST/UNKNOWN',
    lengthMm,elementLengthSource:'component-ref-endpoint-span',mapped:false,weight:0,...extra};
  const ranking=rankXmlCiiWeightCandidates({...props},config,{includeRejected:true});
  return {config,input:{...props,ranking,candidates:ranking.candidates.slice(0,5),
    rejectedCandidates:ranking.rejectedCandidates.slice(0,3)}};
}
function result(lengthMm,extra={}) {
  const {input,config}=issue(lengthMm,extra);
  return applyXmlCiiFlangeWeightFallbackToIssue(input,config);
}
test('F01: actual ranked 115mm 15.826kg overwritten with correct 15kg manual advisory',()=>{
  const raw=issue(115),ranked=raw.input.ranking.best;
  assert.ok(ranked,'must exercise real ranked path, not candidates:[] shortcut');
  const corrected=applyXmlCiiFlangeWeightFallbackToIssue(raw.input,raw.config);
  assert.equal(corrected.unknownComponentSuggestion.suggestedKg,15);
  assert.equal(corrected.candidates[0]?.selectedWeight,15);
  assert.equal(corrected.ranking.best?.selectedWeight,15);
  assert.equal(corrected.ranking.best?.preferred,false);
  assert.equal(corrected.ranking.best?.massAuthority,'ESTIMATE_ONLY_NOT_APPROVED_COMPONENT_MASS');
  assert.equal(corrected.ranking.best?.flangeWeightFallback,true);
  assert.equal(corrected.flangeWeightFallback,false);
  assert.equal(collectXmlCiiAutoRigidWeightsFromIssues([corrected]).appliedCount,0);
});
test('F03: 371.2mm may not use swing-check valve, nor flange reference',()=>{
  const r=result(371.2);
  assert.equal(r.unknownComponentSuggestion.referenceFamily,'Flanged Ball Valve-Reduced Bore');
  assert.equal(r.ranking.best?.referenceFamily,'Flanged Ball Valve-Reduced Bore');
  assert.equal(r.ranking.best?.selectedWeight,47.409);
  assert.equal(r.ranking.best?.preferred,false);
  assert.equal(r.ranking.best?.engineeringMassApproved,false);
  assert.equal(collectXmlCiiAutoRigidWeightsFromIssues([r]).appliedCount,0);
});
test('F09: route-only 763.4mm length cannot generate ranked mass',()=>{
  const r=result(763.4,{elementLengthSource:'computed-forward'});
  assert.deepEqual(r.candidates,[]);
  assert.equal(r.ranking.best,null);
  assert.equal(collectXmlCiiAutoRigidWeightsFromIssues([r]).appliedCount,0);
});
test('F02/F08: inferred fallback, non-preferred and no candidate refuse auto-apply',()=>{
  const implicit={...result(115),key:'B1::RIGID',componentRefNo:'=S'};
  assert.equal(collectXmlCiiAutoRigidWeightsFromIssues([implicit]).appliedCount,0);
  assert.equal(collectXmlCiiAutoRigidWeightsFromIssues([{key:'B1::EMPTY',candidates:[]}]).appliedCount,0);
  const fraud={...implicit,massAuthority:'APPROVED_SOURCE_MASS',
    candidates:[{...implicit.candidates[0],preferred:true,
      massAuthority:'APPROVED_SOURCE_MASS',acceptedForCii:true,
      engineeringMassApproved:true}]};
  assert.equal(collectXmlCiiAutoRigidWeightsFromIssues([fraud]).appliedCount,0,
    'inferred/fallback provenance must override forged approval flags');
  const approved={key:'B1::REAL',massAuthority:'APPROVED_SOURCE_MASS',
    candidates:[{selectedWeight:15,preferred:true,massAuthority:'APPROVED_SOURCE_MASS',
      acceptedForCii:true,engineeringMassApproved:true}]};
  const plan=collectXmlCiiAutoRigidWeightsFromIssues([approved]);
  assert.equal(plan.appliedCount,1);
  assert.equal(plan.weightsByKey['B1::REAL'],15);
});
test('F04: both preferred bulk controls cannot persist inferred suggestions',()=>{
  for(const p of [
    'tabs/model-converters/converters/xmltocii2019_helper/weight-match-renderer.js',
    'tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-weight-match.js',
  ]) {
    const s=readFileSync(new URL('../'+p,import.meta.url),'utf8');
    assert.match(s,/best\.preferred !== true/);
    assert.match(s,/best\.massAuthority !== 'APPROVED_SOURCE_MASS'/);
    assert.match(s,/data-advisory-weight/);
    assert.match(s,/best\.inferredWeight/);
  }
});
test('F02: standalone parity only maps explicit Owner overrides, never ranking auto mass',()=>{
  const s=readFileSync(new URL('../tabs/xml-cii-2019-standalone/xml-cii-standalone-run-parity.js',import.meta.url),'utf8');
  assert.match(s,/const weight = Number\.isFinite\(override\) && override > 0 \? override : null/);
  assert.doesNotMatch(s,/const auto = nr\.weightMatch/);
});
test('F07: missing-master behavior change remains visible, not described as unchanged output',()=>{
  const s=readFileSync(new URL('../converters/empirical-weight/empirical-weight-estimator.js',import.meta.url),'utf8');
  assert.match(s,/return \{ \.\.\.details, ok: false/);
});
