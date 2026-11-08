import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  availableWeightReviewChoices,preferredWeightReviewDraft,weightReviewChoiceLabel,comparisonWeightMasterReferences
} from '../converters/xml-cii2019-core/weight-review-choices.js';
import {applyModeAConsolidatedRigidReviewUpdates} from
  '../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a-state.js';

const sample={
  componentType:'VALV',mapped:false,sourceBoreHold:false,lengthMm:368,
  candidates:[
    {selectedWeight:47,typeDesc:'Flanged Ball Valve-Reduced Bore',rowLength:368,lengthDelta:0,weightMethod:'master'},
    {selectedWeight:47.6,typeDesc:'Flanged Ball Valve-Reduced Bore',rowLength:370,lengthDelta:2,weightMethod:'master'}
  ],
  rejectedCandidates:[
    {selectedWeight:49.2,typeDesc:'Flanged Ball Valve-Reduced Bore',rowLength:381,lengthDelta:13,rejectedReason:'outside ±6mm tolerance'}
  ],
};
test('nearest choices preserve qualified references but remove alternatives outside ±6mm',()=>{
  const choices=availableWeightReviewChoices(sample);
  assert.equal(choices.length,2);
  assert.deepEqual(choices.map(x=>x.referenceLengthMm),[368,370]);
  assert.deepEqual(choices.map(x=>x.weight),[47,47.6]);
  assert.equal(choices.every(x=>x.approved===false),true);
  assert.equal(preferredWeightReviewDraft(sample).weight,47);
});
test('fixed ±6mm limit is inclusive; 6.001mm and distant rejected references are hidden',()=>{
  const issue={componentType:'FLAN',dtxr:'WELDING NECK FLANGE 900#',
    lengthMm:147,boreMm:150,rating:900,
    candidates:[
      {selectedWeight:59,typeDesc:'Weldneck Flange',rowLength:147},
      {selectedWeight:61,typeDesc:'Weldneck Flange',rowLength:153},
      {selectedWeight:62,typeDesc:'Weldneck Flange',rowLength:153.001}
    ],
    rejectedCandidates:[
      {selectedWeight:43,typeDesc:'Weldneck Flange',rowLength:124,lengthDelta:23},
      {selectedWeight:58,typeDesc:'Weldneck Flange',rowLength:141,lengthDelta:6},
    ],
    comparisonReferences:[
      {selectedWeight:47,typeDesc:'Weldneck Flange',rowLength:134,lengthDelta:13,referenceOnly:true,
        rowBore:125,rowRating:900,sourceBore:150,sourceRating:900},
      {selectedWeight:56,typeDesc:'Weldneck Flange',rowLength:151,lengthDelta:4,referenceOnly:true,
        rowBore:150,rowRating:600,sourceBore:150,sourceRating:900},
    ]};
  const choices=availableWeightReviewChoices(issue);
  assert.deepEqual(choices.map(c=>c.weight),[59,61,58,56]);
  assert.ok(choices.at(-1).comparison && choices.at(-1).rejected);
  assert.match(weightReviewChoiceLabel(choices.at(-1)),/COMPARISON ONLY \/ NOT A MATCH/);
  assert.equal(preferredWeightReviewDraft(issue).weight,59);
});
test('cross-DN/Class comparison master rows are exposed only within ±6mm',()=>{
  const issue={componentType:'FLAN',dtxr:'WELDING NECK FLANGE SCH 40S 900#',
    boreMm:150,rating:900,lengthMm:147};
  const rows=[
    {TypeDesc:'Weldneck Flange',DN:150,Rating:900,length:147,'RF/RTJ KG':59},
    {TypeDesc:'Weldneck Flange',DN:150,Rating:600,length:147,'RF/RTJ KG':43},
    {TypeDesc:'Weldneck Flange',DN:150,Rating:1500,length:178,'RF/RTJ KG':92},
    {TypeDesc:'Weldneck Flange',DN:150,Rating:150,length:89,'RF/RTJ KG':13},
    {TypeDesc:'Weldneck Flange',DN:125,Rating:900,length:151,'RF/RTJ KG':47},
    {TypeDesc:'Weldneck Flange',DN:125,Rating:900,length:134,'RF/RTJ KG':45},
    {TypeDesc:'Weldneck Flange',DN:150,Rating:600,length:153.001,'RF/RTJ KG':44},
  ];
  const comparisons=comparisonWeightMasterReferences(issue,{weight:{masterRows:rows}});
  assert.deepEqual(comparisons.map(x=>x.selectedWeight),[43,47]);
  assert.ok(comparisons.every(x=>x.lengthDelta<=6));
  assert.ok(comparisons.every(x=>x.referenceOnly));
  assert.ok(comparisons.every(x=>/COMPARISON ONLY/.test(x.rejectedReason)));
});
test('real weight master never exposes out-of-tolerance cross-DN/Class comparisons',()=>{
  const rows=JSON.parse(readFileSync(new URL('../docs/Masters/wtValveweights.json',import.meta.url),'utf8'));
  const issue={componentType:'VALV',dtxr:'BALL VALVE TRUNN FB FLGD 900#',boreMm:50,rating:900,lengthMm:368};
  const references=comparisonWeightMasterReferences(issue,{weight:{masterRows:rows}});
  assert.ok(references.every(r=>Math.abs(r.rowLength-368)<=6+1e-6));
  assert.ok(references.every(r=>/FULL BORE/i.test(r.typeDesc)));
  const choices=availableWeightReviewChoices({...issue,
    candidates:[{selectedWeight:56,typeDesc:'Flanged Ball Valve -Full Bore',rowLength:368,lengthDelta:0}],
    comparisonReferences:references});
  assert.ok(choices.every(c=>c.referenceLengthMm===null ||
    Math.abs(c.referenceLengthMm-368)<=6+1e-6));
  assert.equal(preferredWeightReviewDraft({...issue,
    candidates:[{selectedWeight:56,typeDesc:'Flanged Ball Valve -Full Bore',rowLength:368}],
    comparisonReferences:references}).weight,56);
  assert.ok(choices.slice(1).every(c=>c.rejected&&c.comparison&&!c.approved));
});
test('out-of-tolerance rejected options are not displayable or preferrable',()=>{
  const row={...sample,candidates:[]};
  assert.deepEqual(availableWeightReviewChoices(row),[]);
  assert.equal(preferredWeightReviewDraft(row),null);
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

test('standalone and ATTA estimate buttons copy numeric drafts without independent approval',async()=>{
  for(const file of ['xml-cii-adapted-run-workflow.js','xml-cii-adapted-run-workflow-atta-default.js']){
    const {rigidCandidateButtons}=await import('../tabs/xml-cii-2019-standalone/ui-adapted/'+file);
    const issue={componentType:'FLAN',dtxr:'BLIND FLANGE 900#',
      boreMm:80,rating:900,lengthMm:112.2,
      candidates:[{selectedWeight:46.343,referenceFamily:'Blind Flange',
        typeDesc:'Blind Flange',weightMethod:'length-extrapolated',inferredWeight:true,
        rowLength:80,rowBore:80,rowRating:900}]};
    const html=rigidCandidateButtons(issue,3);
    assert.match(html,/data-rigid-review-candidate="3"/);
    assert.match(html,/data-rigid-review-weight="46.343"/);
    assert.match(html,/data-rigid-review-approved="false"/);
    assert.match(html,/≈ 46.343 kg · Blind Flange · estimate only/);
    assert.doesNotMatch(html,/data-rigid-review-advisory/);
    assert.equal((html.match(/<button/g)||[]).length,1);
    const alternatives=rigidCandidateButtons({...issue,lengthMm:147,
      candidates:[
        {selectedWeight:59,typeDesc:'Weldneck Flange',rowLength:147,rowBore:80,rowRating:900},
        {selectedWeight:43,typeDesc:'Weldneck Flange',rowLength:124,rowBore:80,rowRating:900},
        {selectedWeight:61,typeDesc:'Weldneck Flange',rowLength:153,rowBore:80,rowRating:900}
      ]},0);
    assert.match(alternatives,/59 kg/);
    assert.doesNotMatch(alternatives,/43 kg/);
    assert.match(alternatives,/61 kg/);
  }
});
test('all pending independent-mass drafts render as a structured, escaped table',async()=>{
  const {modeABulkReviewTableMarkup}=await import(
    '../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a.js');
  const drafts=Array.from({length:109},(_,i)=>({
    fileName:'BM2.xml',branchName:'Line <unsafe>',nodeNumber:String(i+1),
    componentRef:'=1342/8045_2',weightKg:String(59+i),
    dtxr:'WELDING NECK FLANGE SCH 40S 900#'
  }));
  const html=modeABulkReviewTableMarkup(drafts);
  assert.equal((html.match(/data-mode-a-rigid-bulk-review-row/g)||[]).length,109);
  assert.match(html,/<thead>/);
  assert.match(html,/Draft mass \(kg\)/);
  assert.match(html,/=1342\/8045_2/);
  assert.doesNotMatch(html,/<unsafe>/);
  assert.match(html,/Line &lt;unsafe&gt;/);
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
