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
test('length=flange+6 is HOLD, not silently classified as either family',()=>{
  const r=applyXmlCiiFlangeWeightFallbackToIssue(make(115),config);
  assert.equal(r.unknownComponentSuggestion?.ok,false);
  assert.equal(r.unknownComponentSuggestion.code,'LENGTH_AT_DECISION_BOUNDARY');
});
test('master row absent is not silently substituted by a different rating',()=>{
  const c={weight:{masterRows:[{TypeDesc:'Weldneck Flange',Rating:150,DN:50,length:109,'RF/RTJ KG':15}]}};
  const r=applyXmlCiiFlangeWeightFallbackToIssue(make(19.1),c);
  assert.equal(r.unknownComponentSuggestion?.ok,false);
  assert.equal(r.unknownComponentSuggestion.code,'FLANGE_REFERENCE_NOT_QUALIFIED');
});
test('both parent and standalone Weight Match expose passive non-auto-apply suggestions',()=>{
  for(const filename of [
    'tabs/model-converters/converters/xmltocii2019_helper/weight-match-renderer.js',
    'tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-weight-match.js',
  ]){
    const src=readFileSync(new URL('../'+filename,import.meta.url),'utf8');
    assert.match(src,/data-unknown-weight-suggestion/);
    assert.match(src,/const unknown = issue\.unknownComponentSuggestion/);
    assert.match(src,/const chips = \[accepted, unknownText, rejected\]/);
    assert.doesNotMatch(src,/data-wm-candidate="\$\{[^}]*unknown/);
  }
});
