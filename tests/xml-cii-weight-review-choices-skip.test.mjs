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
test('consolidated popup uses clickable buttons and no dropdown or Use draft',async()=>{
  const {modeARigidCandidateMarkup,modeARigidSelectableSuggestions}=
    await import('../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a.js');
  const issue={componentType:'FLAN',dtxr:'WELDING NECK FLANGE SCH 40S 900#',
    boreMm:80,rating:900,lengthMm:109,reviewLengthToleranceMm:6,
    candidates:[
      {selectedWeight:15,typeDesc:'Weldneck Flange',rowLength:109,rowBore:80,rowRating:'900',preferred:true},
      {selectedWeight:16,typeDesc:'Weldneck Flange',rowLength:115,rowBore:80,rowRating:'900',lengthQualified:true},
      {selectedWeight:19,typeDesc:'Weldneck Flange',rowLength:115.01,rowBore:80,rowRating:'900'},
      {selectedWeight:22,typeDesc:'Weldneck Flange',rowLength:109,rowBore:100,rowRating:'900'},
      {selectedWeight:23,typeDesc:'Weldneck Flange',rowLength:109,rowBore:80,rowRating:'1500'},
      {selectedWeight:24,typeDesc:'Blind Flange',rowLength:109,rowBore:80,rowRating:'900'},
    ]};
  const choices=modeARigidSelectableSuggestions(issue);
  assert.deepEqual(choices.map(c=>c.weight),[15,16],
    'only exact DN, class, family and 0..6mm length delta alternatives');
  assert.deepEqual(modeARigidSelectableSuggestions({...issue,reviewLengthToleranceMm:10}).map(c=>c.weight),
    [15,16],'hard +6mm cap still holds if configurable ranking tolerance is larger');
  const html=modeARigidCandidateMarkup(issue,0);
  assert.equal((html.match(/<button /g)||[]).length,2);
  assert.match(html,/data-mode-a-rigid-candidate="0"/);
  assert.match(html,/16 kg/);
  assert.match(html,/L=115 mm/);
  assert.doesNotMatch(html,/Other reference lengths|Choose an alternative|Use draft|advisory only|<select/);
});

test('Blind Flange 46.343 kg extrapolated estimate is a clickable primary button',async()=>{
  const {modeARigidCandidateMarkup,modeARigidSelectableSuggestions}=
    await import('../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a.js');
  const blind={componentType:'FLAN',dtxr:'BLIND FLANGE 900#',
    boreMm:80,rating:900,lengthMm:112.2,
    candidates:[{selectedWeight:46.343,referenceFamily:'Blind Flange',
      typeDesc:'Blind Flange',weightMethod:'length-extrapolated',inferredWeight:true,
      rowBore:80,rowRating:'900',rowLength:80}]};
  assert.deepEqual(modeARigidSelectableSuggestions(blind).map(x=>x.weight),[46.343]);
  const html=modeARigidCandidateMarkup(blind,3);
  assert.match(html,/data-mode-a-rigid-candidate="3"/);
  assert.match(html,/data-mode-a-rigid-weight="46.343"/);
  assert.match(html,/≈ 46.343 kg · Blind Flange · estimate only/);
  assert.doesNotMatch(html,/advisory only|Other reference lengths|Choose an alternative|Use draft|<select/);
});
test('Weldneck Flange 9.689 kg extrapolation is a clickable primary button',async()=>{
  const {modeARigidCandidateMarkup}=await import('../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a.js');
  const html=modeARigidCandidateMarkup({
    componentType:'FLAN',dtxr:'WELDING NECK FLANGE 900#',
    boreMm:40,rating:900,lengthMm:109,
    candidates:[{selectedWeight:9.689,referenceFamily:'Weldneck Flange',
      weightMethod:'length-extrapolated',inferredWeight:true,
      rowBore:40,rowRating:'900',rowLength:82}]
  },1);
  assert.match(html,/≈ 9.689 kg · Weldneck Flange · length-extrapolated/);
  assert.match(html,/data-mode-a-rigid-candidate="1"/);
});

test('explicit review receipts remain separate from weights and zero skips',()=>{
  const result=applyModeAConsolidatedRigidReviewUpdates(state,{BM2:{
    weightsByKey:{'KEY-REVIEWED':17,'KEY-MANUAL':7},
    skippedByKey:{'KEY-BLIND':{skipped:true,weightKg:0}},
    reviewReceiptsByKey:{'KEY-REVIEWED':{
      reviewed:true,reviewMethod:'EXPLICIT_BULK_OWNER_ATTESTATION',
      weightKg:17,sourceComponentRef:'=134/28062',sourceEndpoint:'2',
    }},
  }});
  const cfg=JSON.parse(result.sourceBatch.sources[0].supportConfigJson);
  assert.equal(cfg.overrides.rigidWeight['KEY-REVIEWED'],17);
  assert.equal(cfg.overrides.rigidWeight['KEY-MANUAL'],7);
  assert.equal(cfg.overrides.rigidWeight['KEY-BLIND'],undefined);
  assert.equal(cfg.overrides.rigidWeightReviewReceipts['KEY-REVIEWED'].reviewMethod,
    'EXPLICIT_BULK_OWNER_ATTESTATION');
  assert.equal(cfg.overrides.rigidWeightReviewReceipts['KEY-REVIEWED'].sourceComponentRef,'=134/28062');
  assert.equal(cfg.overrides.rigidWeightReviewReceipts['KEY-MANUAL'],undefined);
  assert.equal(cfg.overrides.rigidWeightReviewReceipts['KEY-BLIND'],undefined);
  assert.equal(Object.keys(cfg.overrides.rigidWeightReviewReceipts).length,1);
});
test('review receipts cannot claim an accepted mass different from saved source override',()=>{
  assert.throws(()=>applyModeAConsolidatedRigidReviewUpdates(state,{BM2:{
    weightsByKey:{'KEY-REVIEWED':17},
    reviewReceiptsByKey:{'KEY-REVIEWED':{
      reviewed:true,reviewMethod:'EXPLICIT_BULK_OWNER_ATTESTATION',weightKg:18
    }}
  }}),/Invalid physical mass review receipt/);
});
test('review receipts cannot be fabricated by a generic estimated suggestion',()=>{
  assert.throws(()=>applyModeAConsolidatedRigidReviewUpdates(state,{BM2:{
    weightsByKey:{'KEY-REVIEWED':17},
    reviewReceiptsByKey:{'KEY-REVIEWED':{
      reviewed:false,reviewMethod:'CATALOG_EXACT_MATCH',weightKg:17
    }}
  }}),/Invalid physical mass review receipt/);
});
test('consolidated UI requires explicit checkbox before mass review bulk confirmation',()=>{
  const html=readFileSync(new URL('../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a.js',import.meta.url),'utf8');
  assert.match(html,/data-mode-a-rigid-open-review/);
  assert.match(html,/data-mode-a-rigid-bulk-attest/);
  assert.match(html,/data-mode-a-rigid-confirm-bulk-review disabled/);
  assert.match(html,/reviewConfirm\.disabled=!reviewAttest\.checked/);
  assert.match(html,/data-mode-a-rigid-show-unreviewed/);
  assert.match(html,/Nothing was applied/);
  assert.doesNotMatch(html,/if\(unreviewed\.length\)\s*unreviewed\.forEach[^\n]*checked=true/);
});
