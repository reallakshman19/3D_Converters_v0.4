import test from 'node:test';
import assert from 'node:assert/strict';
import {
  phase6ComparableReference,phase6ReferenceErrorPercent,
  phase6DeviationForRow,phase6BatchDeviationDraft,
  PHASE6_DEVIATION_LIMIT_PCT,
} from '../converters/xml-cii2019-core/phase6-mass-comparison.js';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

function sample(patch={}){
  return {mapped:true,componentType:'FLAN',
    dtxr:'WELDING NECK FLANGE SCH40S 900#',boreMm:150,rating:900,
    lengthMm:147,reviewLengthToleranceMm:6,
    candidates:[{
      selectedWeight:59,typeDesc:'Weldneck Flange',
      rowLength:147,rowBore:150,rowRating:900,preferred:true,
      totalScore:1,
    }],...patch};
}
test('matched catalog reference is visible but never independent mass approval',()=>{
  const r=phase6ComparableReference(sample());
  assert.equal(r.kg,59);
  assert.equal(r.lengthMm,147);
  assert.equal(r.authority,'CATALOG_COMPARISON_ONLY');
  assert.equal(r.approved,false);
  assert.equal(phase6ReferenceErrorPercent(59,59),0);
  assert.equal(phase6ReferenceErrorPercent(61,59),200/59);
  assert.ok(Math.abs(phase6ReferenceErrorPercent(35.4,59)+40)<1e-9);
  assert.ok(Math.abs(phase6ReferenceErrorPercent(82.6,59)-40)<1e-9);
  assert.equal(phase6ReferenceErrorPercent('',59),null);
  assert.equal(phase6ReferenceErrorPercent(59,0),null);
  assert.equal(PHASE6_DEVIATION_LIMIT_PCT,40);
});
test('the ±6mm comparison uses the unscaled master kg, never extrapolated selected kg',()=>{
  const reference=phase6ComparableReference(sample({
    lengthMm:150,
    candidates:[{
      selectedWeight:61,masterWeight:59,weight:59,typeDesc:'Weldneck Flange',
      rowLength:147,rowBore:150,rowRating:900,preferred:false,
      weightMethod:'length-extrapolated',
    }],
  }));
  assert.equal(reference.kg,59);
  assert.equal(reference.authority,'CATALOG_COMPARISON_ONLY');
  assert.equal(phase6BatchDeviationDraft(sample({
    lengthMm:150,mapped:true,
    candidates:[{
      selectedWeight:61,masterWeight:59,weight:59,typeDesc:'Weldneck Flange',
      rowLength:147,rowBore:150,rowRating:900,weightMethod:'length-extrapolated',
    }],
  }),118).weight,59);
});
test('strict >±40% gate stages a review draft rather than granting approval',()=>{
  assert.equal(phase6BatchDeviationDraft(sample(),59),null);
  assert.equal(phase6BatchDeviationDraft(sample(),82.6),null);
  const high=phase6BatchDeviationDraft(sample(),118);
  assert.equal(high.weight,59);
  assert.equal(high.approved,false);
  assert.equal(high.method,'PHASE6_DEVIATION_GT_40_REVIEW_DRAFT');
  assert.equal(high.errorPct,100);
  const low=phase6BatchDeviationDraft(sample(),20);
  assert.equal(low.weight,59);
  assert.equal(low.approved,false);
  assert.ok(low.errorPct<-40);
  assert.equal(phase6BatchDeviationDraft(sample({mapped:false}),118),null);
});
test('cross-DN, different Class, overlength, blind extrapolation and unknown are ineligible',()=>{
  const row=sample();
  for(const patch of [
    {rowBore:125},{rowRating:600},{rowLength:153.01},
    {inferredWeight:true},{fallbackSuggestion:true},
    {weightMethod:'length-extrapolated'},
    {rejectedReason:'LENGTH_MISMATCH'},
    {zeroFallback:true},{referenceOnly:true},
  ])assert.equal(phase6ComparableReference({...row,candidates:[{...row.candidates[0],...patch}]}),
    null,JSON.stringify(patch));
  assert.equal(phase6ComparableReference({...row,sourceBoreHold:true}),null);
  assert.equal(phase6ComparableReference({...row,rating:''}),null);
  assert.equal(phase6ComparableReference({...row,boreMm:null}),null);
  assert.equal(phase6ComparableReference({...row,lengthMm:0}),null);
  assert.equal(phase6ComparableReference({...row,componentType:'VALV'}),null);
});
test('all approval icons and threshold controls preserve independent acceptance',()=>{
  const src=read('tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a.js');
  for(const name of ['data-phase6-approve-all','data-phase6-deviation40',
    'data-phase6-reference-kg','data-phase6-error-pct'])assert.ok(src.includes(name),name);
  assert.match(src,/phase6BatchDeviationDraft\(issue,input\.value\)/);
  assert.match(src,/stageRigidReviewProposal\(input,draft\)/);
  assert.match(src,/data-mode-a-rigid-bulk-attest/);
  assert.match(src,/data-mode-a-rigid-confirm-bulk-review disabled/);
  assert.match(src,/showBulkReview\(\)/);
  assert.match(src,/Save Reviewed Weights \(No Run\)/);
  assert.doesNotMatch(src,/data-phase6-approve-all[^\n]*engineeringMassApproved=true/);
});
