import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  applyPhase6SingleReview, applyPhase6ModeAReview, undoPhase6Review,
  phase6ReviewSingleSourceId
} from '../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-phase6-unified-review.js';
import {
  modeARigidSelectableSuggestions
} from '../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a.js';

const file=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sourceId=phase6ReviewSingleSourceId();
const parse=state=>JSON.parse(state.supportConfigJson);

test('mapped mass 59 -> 61 is source-local, invalidates stale attestation and can undo',()=>{
  const baseline={supportConfigJson:JSON.stringify({overrides:{
    rigidWeight:{'BRANCH::ref_2':59},
    rigidWeightReviewReceipts:{'BRANCH::ref_2':{
      reviewed:true,reviewMethod:'EXPLICIT_BULK_OWNER_ATTESTATION',weightKg:59,
    }},
  }}),result:{ok:true},outputRunReadinessReport:{ready:true},
    masterContext:{config:{}}};
  const updated=applyPhase6SingleReview(baseline,{
    [sourceId]:{weightsByKey:{'BRANCH::ref_2':61}},
  });
  assert.equal(parse(updated).overrides.rigidWeight['BRANCH::ref_2'],61);
  assert.equal(parse(updated).overrides.rigidWeightReviewReceipts?.['BRANCH::ref_2'],undefined);
  assert.equal(updated.result,null);
  assert.equal(updated.phase6Undo.mode,'single');
  const undone=undoPhase6Review(updated);
  assert.equal(undone.supportConfigJson,baseline.supportConfigJson);
  assert.equal(parse(undone).overrides.rigidWeightReviewReceipts['BRANCH::ref_2'].weightKg,59);
  assert.equal(undone.phase6Undo,null);
});

test('cross-source mass edits and undo cannot change another XML model',()=>{
  const a='BRANCH::ref_2';
  const cfg1=JSON.stringify({overrides:{rigidWeight:{[a]:59}}});
  const cfg2=JSON.stringify({overrides:{rigidWeight:{[a]:13}}});
  const state={sourceKind:'xml',sourceText:'<PipeStressExport/>',
    supportConfigJson:cfg1,sourceBatch:{
      mode:'separate-models',activeSourceId:'SRC1',
      sources:[
        {sourceId:'SRC1',fileName:'A.xml',enabled:true,sourceText:'<PipeStressExport/>',supportConfigJson:cfg1},
        {sourceId:'SRC2',fileName:'B.xml',enabled:true,sourceText:'<PipeStressExport/>',supportConfigJson:cfg2},
      ],
    }};
  const out=applyPhase6ModeAReview(state,{SRC1:{weightsByKey:{[a]:61}}});
  assert.equal(JSON.parse(out.sourceBatch.sources[0].supportConfigJson).overrides.rigidWeight[a],61);
  assert.equal(out.sourceBatch.sources[1].supportConfigJson,cfg2);
  const undone=undoPhase6Review(out);
  assert.equal(undone.sourceBatch.sources[0].supportConfigJson,cfg1);
  assert.equal(undone.sourceBatch.sources[1].supportConfigJson,cfg2);
});

test('nearby mismatched-DN/Class comparison is draft only, ±6 mm is strict',()=>{
  const issue={componentType:'FLAN',dtxr:'WELDNECK FLANGE CLASS 900',rating:900,
    boreMm:150,lengthMm:147,candidates:[{
      selectedWeight:59,typeDesc:'Weldneck Flange',
      rowLength:147,rowBore:150,rowRating:900,preferred:true,
    }],comparisonReferences:[
      {selectedWeight:43,typeDesc:'Weldneck Flange',
        rowLength:151,rowBore:150,rowRating:600},
      {selectedWeight:13,typeDesc:'Weldneck Flange',
        rowLength:89,rowBore:150,rowRating:150},
    ]};
  const choices=modeARigidSelectableSuggestions(issue);
  assert.equal(choices.length,2);
  assert.equal(choices[1].weight,43);
  assert.equal(choices[1].approved,false);
  assert.equal(choices[1].comparison,true);
  assert.match(choices[1].displayMethod,/COMPARISON ONLY/);
});

test('exact/nearest/mapped-edit toolbar and original columns survive for Phase 6',()=>{
  const ui=file('tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a.js');
  const phase=file('tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-phase6-unified-review.js');
  for(const c of ['Line Key','Component Type','Valve Hint','Current Weight','Status',
    'Score','Candidate Type','Nearest Suggestions','Bore','Rating','DTXR','Length']){
    assert.ok(ui.includes(c),c);
  }
  for(const control of ['data-phase6-nearest','data-phase6-find-exact',
    'data-phase6-fill-similar','data-phase6-row-edit','data-mode-a-rigid-apply-suggestions',
    'data-mode-a-rigid-skip-blanks','data-mode-a-rigid-open-review',
    'data-mode-a-rigid-refresh','data-mode-a-rigid-fill-exact'])assert.ok(ui.includes(control),control);
  for(const control of ['data-phase6-undo','data-phase6-ledger','data-phase6-open-review']){
    assert.ok(phase.includes(control),control);
  }
  assert.match(ui,/Save Reviewed Weights \(No Run\)/);
  assert.match(ui,/if\(phase6 && input\.value==='\'\)return;/);
  assert.match(ui,/if\(issue\.mapped\)return includeMapped/);
});
