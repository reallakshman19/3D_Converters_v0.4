import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  applyXmlCiiFlangeWeightFallbackToIssue,
} from '../converters/xml-cii2019-core/flange-weight-fallback.js';
import { DEFAULT_WEIGHT_MASTER_ROWS } from '../converters/xml-cii2019-core/default-weight-master-rows.js';

const config={weight:{masterRows:DEFAULT_WEIGHT_MASTER_ROWS}};
const make = (lengthMm,extra={})=>({
  componentType:'PCOM',componentRefNo:'=TEST/UNKNOWN',boreMm:50,
  rating:900,lengthMm,elementLengthSource:'ElementLengthMm',
  weight:0,mapped:false,candidates:[],rejectedCandidates:[],...extra,
});
test('unresolved 19.1mm component gets passive flange-reference suggestion',()=>{
  const source=make(19.1);
  const issue=applyXmlCiiFlangeWeightFallbackToIssue(source,config);
  assert.equal(issue.unknownComponentSuggestion?.ok,true);
  assert.equal(issue.unknownComponentSuggestion.selector,'FLANGE_REFERENCE');
  assert.equal(issue.unknownComponentSuggestion.suggestedKg,2.628);
  assert.equal(issue.unknownComponentSuggestion.acceptedForCii,false);
  assert.equal(source.unknownComponentSuggestion,undefined);
  assert.deepEqual(issue.candidates,[],'advisory must not enter ranked/auto-apply candidates');
});
test('long unresolved component uses reduced-bore ball valve with same class',()=>{
  const issue=applyXmlCiiFlangeWeightFallbackToIssue(make(371.2),config);
  assert.equal(issue.unknownComponentSuggestion?.ok,true);
  assert.equal(issue.unknownComponentSuggestion.referenceFamily,'Flanged Ball Valve-Reduced Bore');
  assert.equal(issue.unknownComponentSuggestion.suggestedKg,47.409);
  assert.equal(issue.unknownComponentSuggestion.engineeringMassApproved,false);
});
test('approved/mapped weight and a route-only length cannot be overwritten or suggested',()=>{
  assert.equal(applyXmlCiiFlangeWeightFallbackToIssue(make(19.1,{mapped:true,weight:15}),config)
    .unknownComponentSuggestion,undefined);
  assert.equal(applyXmlCiiFlangeWeightFallbackToIssue(make(19.1,{elementLengthSource:'computed-forward'}),config)
    .unknownComponentSuggestion,undefined);
});
test('length=flange+6 displays full 15kg flange as-is, without applying a weight',()=>{
  const r=applyXmlCiiFlangeWeightFallbackToIssue(make(115),config);
  assert.equal(r.unknownComponentSuggestion?.ok,true);
  assert.equal(r.unknownComponentSuggestion.referenceFamily,'Weldneck Flange');
  assert.equal(r.unknownComponentSuggestion.suggestedKg,15);
  assert.equal(r.unknownComponentSuggestion.lengthRatio,1);
  assert.equal(r.unknownComponentSuggestion.method,'FLANGE_MASTER_AS_IS_AT_6MM_TOLERANCE');
  assert.equal(r.unknownComponentSuggestion.acceptedForCii,false);
  assert.equal(r.unknownComponentSuggestion.engineeringMassApproved,false);
  // Legacy fallback may still expose a separate manual candidate,
  // but it must now agree with the source master (15kg, never 15.826kg).
  assert.equal(r.candidates?.[0]?.selectedWeight,15);
  assert.equal(r.candidates?.[0]?.weightMethod,'flange-master-at-6mm-tolerance');
  assert.equal(r.candidates?.[0]?.preferred,false);
});
test('master row absent is not silently substituted by a different rating',()=>{
  const c={weight:{masterRows:[{TypeDesc:'Weldneck Flange',Rating:150,DN:50,length:109,'RF/RTJ KG':15}]}};
  const r=applyXmlCiiFlangeWeightFallbackToIssue(make(19.1),c);
  assert.equal(r.unknownComponentSuggestion?.ok,false);
  assert.equal(r.unknownComponentSuggestion.code,'FLANGE_REFERENCE_NOT_QUALIFIED');
});
test('ambiguous imported length-unit mode HOLDS the suggestion',()=>{
  const cfg={weight:{masterRows:DEFAULT_WEIGHT_MASTER_ROWS,convertSmallLengthsInToMm:true}};
  const answer=applyXmlCiiFlangeWeightFallbackToIssue(make(19.1),cfg);
  assert.equal(answer.unknownComponentSuggestion.ok,false);
  assert.equal(answer.unknownComponentSuggestion.code,'MASTER_LENGTH_UNIT_REVIEW_REQUIRED');
  assert.deepEqual(answer.candidates,[]);
});
test('both parent and standalone Weight Match expose passive non-auto-apply suggestions',()=>{
  for(const filename of [
    'tabs/model-converters/converters/xmltocii2019_helper/weight-match-renderer.js',
    'tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-weight-match.js',
  ]){
    const src=readFileSync(new URL('../'+filename,import.meta.url),'utf8');
    assert.match(src,/data-unknown-weight-suggestion/);
    assert.match(src,/data-unknown-weight-hold/);
    assert.match(src,/const unknown = issue\.unknownComponentSuggestion/);
    if(filename.includes('weight-match-renderer.js')){
      assert.match(src,/const chips = \[accepted, choices\.length \? '' : unknownText, rejected\]/);
      assert.match(src,/data-wm-choice="/);
      assert.doesNotMatch(src,/data-wm-verified|data-wm-save-reviewed/);
      assert.match(src,/if\(input.dataset.wmProposalDraft\) return false/);
      assert.match(src,/mc-wm-batch-attest/);
      assert.match(src,/rigidWeightReviewReceipts/);
      assert.match(src,/stageDraft\(input,choice\)/);
      assert.doesNotMatch(src,/data-wm-candidate="\$\{[^}]*unknown/);
    } else {
      assert.match(src,/const chips = \[accepted, unknownText, rejected\]/);
      assert.doesNotMatch(src,/data-wm-candidate="\$\{[^}]*unknown/);
    }
  }
});
