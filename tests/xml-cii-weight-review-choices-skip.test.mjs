import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  availableWeightReviewChoices,preferredWeightReviewDraft,weightReviewChoiceLabel,comparisonWeightMasterReferences
} from '../converters/xml-cii2019-core/weight-review-choices.js';
import {applyModeAConsolidatedRigidReviewUpdates} from
  '../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a-state.js';

const sample={
  componentType:'VALV',mapped:false,sourceBoreHold:false,
  candidates:[
    {selectedWeight:47,typeDesc:'Flanged Ball Valve-Reduced Bore',rowLength:368,lengthDelta:0,weightMethod:'master'},
    {selectedWeight:47.6,typeDesc:'Flanged Ball Valve-Reduced Bore',rowLength:370,lengthDelta:2,weightMethod:'master'}
  ],
  rejectedCandidates:[
    {selectedWeight:49.2,typeDesc:'Flanged Ball Valve-Reduced Bore',rowLength:381,lengthDelta:13,rejectedReason:'outside ±6mm tolerance'}
  ],
};
test('multiple same-family master lengths remain visible as distinct selectable alternatives',()=>{
  const choices=availableWeightReviewChoices(sample);
  assert.equal(choices.length,3);
  assert.deepEqual(choices.map(x=>x.referenceLengthMm),[368,370,381]);
  assert.deepEqual(choices.map(x=>x.weight),[47,47.6,49.2]);
  assert.equal(choices.every(x=>x.approved===false),true);
  assert.equal(choices[2].rejected,true);
  assert.match(weightReviewChoiceLabel(choices[2]),/LENGTH MISMATCH/);
  assert.equal(preferredWeightReviewDraft(sample).weight,47);
});
test('real 1595-row master exposes full-bore same-family alternate lengths without changing qualified candidate',()=>{
  const rows=JSON.parse(readFileSync(new URL('../docs/Masters/wtValveweights.json',import.meta.url),'utf8'));
  const issue={componentType:'VALV',dtxr:'BALL VALVE TRUNN FB FLGD 900#',boreMm:50,rating:900,lengthMm:368};
  const references=comparisonWeightMasterReferences(issue,{weight:{masterRows:rows}});
  assert.ok(references.length>=2,'a DN50 Class900 Full Bore valve has legitimate comparative refs');
  assert.ok(references.every(r=>/FULL BORE/i.test(r.typeDesc)),
    'Reduced Bore cannot appear even as a nearby comparison');
  assert.ok(references.some(r=>r.rowBore!==50&&r.rowRating==='900'&&r.rowLength!==368),
    'neighbor DN retains actual master face-to-face length');
  assert.ok(references.some(r=>r.rowBore===50&&r.rowRating!=='900'),
    'same-DN different rating is clearly exposed, never ranked');
  assert.ok(references.every(r=>r.referenceOnly && /COMPARISON ONLY/.test(r.rejectedReason)));
  const choices=availableWeightReviewChoices({...issue,
    candidates:[{selectedWeight:56,typeDesc:'Flanged Ball Valve -Full Bore',rowLength:368,lengthDelta:0}],
    comparisonReferences:references});
  assert.ok(choices.length>2);
  assert.equal(preferredWeightReviewDraft({...issue,candidates:[{selectedWeight:56,typeDesc:'Flanged Ball Valve -Full Bore'}],
    comparisonReferences:references}).weight,56,'comparisons may not prefill');
  assert.ok(choices.slice(1).every(c=>c.rejected&&c.comparison&&!c.approved));
});
test('no out-of-tolerance candidate automatically preprefilled',()=>{
  const row={...sample,candidates:[]};
  assert.equal(availableWeightReviewChoices(row).length,1,'reference remains inspectable');
  assert.equal(preferredWeightReviewDraft(row),null,'LENGTH MISMATCH cannot be prefilled');
});
test('unknown PCOM 12.7mm length rule remains a review-only alternative',()=>{
  const choices=availableWeightReviewChoices({
    massSuggestionOnly:true,componentType:'PCOM',candidates:[sample.candidates[0]],
    unknownComponentSuggestion:{ok:true,suggestedKg:1.748,referenceFamily:'Weldneck Flange',referenceLengthMm:109}
  });
  assert.equal(choices.length,1);
  assert.equal(choices[0].weight,1.748);
  assert.equal(choices[0].approved,false);
  assert.equal(choices[0].referenceLengthMm,109);
});
test('ambiguous physical source identity never creates auto-prefill mass',()=>{
  assert.deepEqual(availableWeightReviewChoices({...sample,sourceBoreHold:true}),[]);
  assert.equal(preferredWeightReviewDraft({...sample,sourceBoreHold:true}),null);
});
const source={
  sourceId:'BM2',fileName:'BM2.xml',
  supportConfigJson:JSON.stringify({overrides:{rigidWeight:{'KEY-APPROVED':59}}})
};
const state={sourceBatch:{activeSourceId:'BM2',sources:[source]}};
test('Skip blank writes auditable 0kg skip but never writes a source rigidWeight override',()=>{
  const result=applyModeAConsolidatedRigidReviewUpdates(state,{BM2:{
    weightsByKey:{'KEY-REVIEWED':15},
    skippedByKey:{'KEY-BLIND':{skipped:true,weightKg:0}},
  }});
  const cfg=JSON.parse(result.sourceBatch.sources[0].supportConfigJson);
  assert.equal(cfg.overrides.rigidWeight['KEY-REVIEWED'],15);
  assert.equal(cfg.overrides.rigidWeight['KEY-APPROVED'],59);
  assert.equal(cfg.overrides.rigidWeight['KEY-BLIND'],undefined);
  assert.deepEqual(cfg.overrides.rigidWeightSkipped['KEY-BLIND'],{
    skipped:true,weightKg:0,reason:'EXPLICIT_ZERO_MASS_SKIP_NO_SOURCE_AUTHORITY'
  });
  assert.equal(JSON.parse(source.supportConfigJson).overrides.rigidWeightSkipped,undefined,
    'immutable input state before explicit Apply');
});
test('Skip blank refuses to erase a positive saved source mass',()=>{
  assert.throws(()=>applyModeAConsolidatedRigidReviewUpdates(state,{
    BM2:{skippedByKey:{'KEY-APPROVED':{skipped:true,weightKg:0}}}
  }),/Cannot skip source mass with existing positive override/);
});
test('rendered modal has visible source-ref and multiple-choice and missing-row controls',async()=>{
  const {modeARigidCandidateMarkup}=await import('../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a.js');
  const html=modeARigidCandidateMarkup({
    ...sample,rating:900,nodeNumber:818,nodeNumberDisplay:818
  },0);
  assert.match(html,/Other reference lengths \/ weights/);
  assert.match(html,/data-mode-a-rigid-choice="0"/);
  assert.match(html,/368mm/);
  assert.match(html,/381mm/);
});
