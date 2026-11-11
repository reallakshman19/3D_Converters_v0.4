import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  planFinalRigidBatchCorrections, planAllNearestBatchDraftSelection,
} from '../tabs/xml-cii-2019-standalone/xml-cii-final-rigid-batch-corrections.js';
import {
  resolveFinalRigidOwnerSelection, qualifyFinalRigidManualReference,
  summarizeFinalRigidBatch,
} from '../tabs/xml-cii-2019-standalone/xml-cii-final-rigid-review-evidence.js';
import {
  createCiiPropertySession, verifyCiiPropertyTransaction,
} from '../tabs/xml-cii-2019-standalone/xml-cii-final-property-transactions.js';

function witness() {
  const inventory = {rows:[]}, plans=[];
  for (let i=1;i<=3;i++) {
    inventory.rows.push({rigidPointer:i,weight:100,rawWeight:'100',status:'LINKED',
      linkedElements:[{index:i,fromNode:String(i*10),toNode:String(i*10+1),lengthMm:109}]});
    plans.push({rigidPointer:i,mapping:{branchName:'/B',componentRefNo:'/C'+i},
      sourceContext:{status:'VERIFIED',conflicts:[],bore:{conflict:false},
        rating:{conflict:false},dtxr:{suppressed:false},ownerCandidates:[]},
      nearestSuggestions:[{referenceWeight:300,masterWeightKg:30,matchPct:100,
        direct:true,approximate:false,comparisonOnly:false}],autoIndex:-1});
  }
  return {inventory,plans};
}
test('structural invalid pointer skips only that pointer while preserving the eligible sibling',()=>{
  const {inventory,plans}=witness();
  inventory.rows[0].linkedElements=[];
  inventory.rows[1].weight=150;inventory.rows[1].rawWeight='150';
  plans[1].nearestSuggestions[0].referenceWeight=150;
  const result=planFinalRigidBatchCorrections(inventory,plans);
  assert.equal(result.proposals[0].status,'SKIPPED_WITH_WARNING');
  assert.equal(result.proposals[0].skipCode,'INVALID_POINTER');
  assert.equal(result.proposals[1].disposition,'NO_CHANGE_REQUIRED');
  assert.equal(result.proposals[2].status,'ELIGIBLE');
  assert.deepEqual(result.eligible.map(p=>p.pointer),[3]);
  const summary=summarizeFinalRigidBatch(result,[3]);
  assert.deepEqual([summary.corrected,summary.unchanged,summary.skipped,summary.unresolved],
    [1,1,1,1]);
  assert.equal(summary.engineeringMassApproval,'NOT_ESTABLISHED_BY_BATCH_REVIEW');
});
test('source-local competing owner requires explicit review rationale; no fabricated refs',()=>{
  const {inventory,plans}=witness();
  plans[0].mapping=null;
  plans[0].sourceContext.status='NOT_RESOLVED';
  plans[0].sourceContext.ownerCandidates=[
    {branchName:'/B',componentRefNo:'/C9',componentType:'FLAN',
      sourceNode:'10',side:'FROM',sourceLengthMm:109},
    {branchName:'/B',componentRefNo:'/C1',componentType:'FLAN',
      sourceNode:'11',side:'TO',sourceLengthMm:109},
  ];
  const blocked=planFinalRigidBatchCorrections(inventory,plans,{includeReviewOnly:true});
  assert.equal(blocked.proposals[0].skipCode,'OWNER_SELECTION_REQUIRED');
  const reviews=new Map([[1,{candidateIndex:1,rationale:'Source drawing confirms TO flange /C1'}]]);
  const accepted=planFinalRigidBatchCorrections(inventory,plans,{
    includeReviewOnly:true,ownerSelections:reviews,
  });
  assert.equal(accepted.proposals[0].status,'ELIGIBLE');
  assert.equal(accepted.proposals[0].reviewRequired,true);
  assert.equal(accepted.proposals[0].ownerResolution.componentRefNo,'/C1');
  assert.equal(accepted.proposals[0].ownerResolution.authority,
    'OPERATOR_SELECTED_SOURCE_CANDIDATE_REVIEW_ONLY');
  assert.equal(summarizeFinalRigidBatch(accepted,[1]).rows[0].ownerResolution.sourceNode,'11');
  reviews.set(1,{candidateIndex:999,rationale:'Fabricated source edge owner choice'});
  assert.equal(planFinalRigidBatchCorrections(inventory,plans,{
    includeReviewOnly:true,ownerSelections:reviews,
  }).proposals[0].skipCode,'OWNER_SELECTION_INVALID');
  assert.equal(resolveFinalRigidOwnerSelection(plans[0].sourceContext,
    {candidateIndex:1,rationale:'short'}).selection,null);
});
test('missing catalog reference can be replaced with evidenced pointer-local manual CII weight',()=>{
  const {inventory,plans}=witness();
  plans[0].nearestSuggestions=[];
  const baseline=planFinalRigidBatchCorrections(inventory,plans);
  assert.equal(baseline.proposals[0].skipCode,'MISSING_REFERENCE');
  const manual=new Map([[1,{referenceWeight:300,documentRef:'SPEC-P-01',
    basis:'Mass allocated to only final CII pointer 1 from drawing',
    unit:'CII_OUTPUT_WEIGHT'}]]);
  const reviewed=planFinalRigidBatchCorrections(inventory,plans,{
    includeReviewOnly:true,manualReferences:manual,
  });
  assert.equal(reviewed.proposals[0].status,'ELIGIBLE');
  assert.equal(reviewed.proposals[0].reviewRequired,true);
  assert.equal(reviewed.proposals[0].candidate.manual,true);
  assert.equal(reviewed.proposals[0].candidate.manualEvidence.documentRef,'SPEC-P-01');
  assert.ok(reviewed.proposals[0].warnings.includes('MANUAL_REFERENCE_REVIEW_ONLY'));
  assert.equal(summarizeFinalRigidBatch(reviewed,[1]).rows[0]
    .referenceProvenance.unit,'CII_OUTPUT_WEIGHT');
  manual.set(1,{referenceWeight:-5,documentRef:'SPEC-P-01',
    basis:'This has incorrect weight units',unit:'CII_OUTPUT_WEIGHT'});
  assert.equal(planFinalRigidBatchCorrections(inventory,plans,{
    includeReviewOnly:true,manualReferences:manual,
  }).proposals[0].skipCode,'INVALID_MANUAL_REFERENCE');
  assert.equal(qualifyFinalRigidManualReference({referenceWeight:300,documentRef:'?',
    basis:'Too little provenance',unit:'CII_OUTPUT_WEIGHT'}).candidate,null);
});
test('shared physical ComponentRefNo requires both sourced owner and manual allocation',()=>{
  const {inventory,plans}=witness();
  plans[1].mapping.componentRefNo=plans[0].mapping.componentRefNo;
  plans[0].sourceContext.ownerCandidates=[{branchName:'/B',componentRefNo:'/C1',
    componentType:'FLAN',sourceNode:'11',side:'TO',sourceLengthMm:109}];
  const original=planFinalRigidBatchCorrections(inventory,plans,{includeReviewOnly:true});
  assert.equal(original.proposals[0].skipCode,'PHYSICAL_OWNER_SHARED');
  const manual=new Map([[1,{referenceWeight:300,documentRef:'SPEC-A1',
    basis:'Split allocation to this pointer only',unit:'CII_OUTPUT_WEIGHT'}]]);
  assert.equal(planFinalRigidBatchCorrections(inventory,plans,{
    includeReviewOnly:true,manualReferences:manual,
  }).proposals[0].skipCode,'PHYSICAL_OWNER_SHARED');
  const ownerSelections=new Map([[1,{candidateIndex:0,rationale:'Ownership and mass split per drawing A1'}]]);
  const qualified=planFinalRigidBatchCorrections(inventory,plans,{
    includeReviewOnly:true,manualReferences:manual,ownerSelections,
  });
  assert.equal(qualified.proposals[0].status,'ELIGIBLE');
  assert.equal(qualified.proposals[1].status,'SKIPPED_WITH_WARNING');
  assert.equal(qualified.proposals[0].candidate.manual,true);
});
test('150-to-150 matches are NO_CHANGE_REQUIRED even if source metadata warns',()=>{
  const {inventory,plans}=witness();
  for (const i of [0,1]) {
    inventory.rows[i].weight=150;inventory.rows[i].rawWeight='150';
    plans[i].nearestSuggestions[0].referenceWeight=150;
  }
  plans[0].sourceContext.conflicts=['RATING_CONFLICT'];
  plans[1].sourceContext.dtxr={suppressed:true,suppressionReason:'SOURCE_UNTRUSTED'};
  const result=planFinalRigidBatchCorrections(inventory,plans,{
    scope:'selected',selectedPointers:[1,2],includeReviewOnly:true,
  });
  assert.deepEqual(result.proposals.slice(0,2).map(p=>p.disposition),
    ['NO_CHANGE_REQUIRED','NO_CHANGE_REQUIRED']);
  assert.equal(result.eligible.length,0);
  assert.equal(summarizeFinalRigidBatch(result).unchanged,2);
  const batch=planAllNearestBatchDraftSelection(inventory,plans,{
    scope:'selected',selectedPointers:[1,2]});
  assert.deepEqual(batch.selectedPointers,[]);
});
const row=(a)=>a.map((v,i)=>String(v).padStart(i?13:15,' ')).join('');
function ciiFixture() {
  const x=['#$ VERSION','2019','#$ CONTROL',row([1,0,0,0,0,0]),
    row([0,1,0,0,0,0]),row([0,0,0,0,0,0]),row([0]),'#$ ELEMENTS',
    row([100,101,109,0,0,60.3]),
    ...Array.from({length:9},()=>row([0,0,0,0,0,0])),
    ('       2 /B').padEnd(80),row([0,0,0,0,0,0]),
    row([0,1,0,0,0,0]),row([0,0,0,0,0,0]),row([0,0,0]),
    '#$ RIGID',row([150,'0.000000'])];
  return x.join('\r\n')+'\r\n';
}
test('no-change transaction fully reparses CII and retains every original byte',async()=>{
  const original=ciiFixture();
  const session=await createCiiPropertySession(original,{
    runIdentity:'NO-CHANGE-SESSION',filename:'source.cii',
  });
  const checked=await verifyCiiPropertyTransaction(session,{
    currentCiiText:original,runIdentity:'NO-CHANGE-SESSION',
  });
  assert.equal(checked.revisedCiiText,original);
  assert.equal(checked.audit.untouchedBytesEqual,true);
  assert.deepEqual(checked.audit.changes,[]);
  assert.equal(checked.audit.originalSha256,checked.audit.revisedSha256);
  await assert.rejects(()=>verifyCiiPropertyTransaction(session,{
    currentCiiText:original.replace('2019','2018'),runIdentity:'NO-CHANGE-SESSION',
  }),/source CII content changed/);
});

test('144-pointer review: 43 eligible corrections proceed despite 14 skips, 87 no-change and 144 warnings',()=>{
  const {inventory,plans}=witness();
  inventory.rows=[]; plans.length=0;
  for(let pointer=1;pointer<=144;pointer++){
    const correctable=pointer<=43;
    const skipped=pointer>43 && pointer<=57;
    inventory.rows.push({
      rigidPointer:pointer,weight:correctable?100:150,
      rawWeight:String(correctable?100:150),
      status:'LINKED',
      linkedElements:skipped?[]:[{index:pointer,fromNode:String(pointer*10),
        toNode:String(pointer*10+1),lengthMm:109}],
    });
    plans.push({rigidPointer:pointer,
      mapping:{branchName:'/B',componentRefNo:'/C'+pointer},
      sourceContext:{status:'CONFLICT_REVIEW',conflicts:['RATING_CONFLICT'],
        bore:{conflict:false},rating:{conflict:true},dtxr:{suppressed:false}},
      nearestSuggestions:[{referenceWeight:correctable?300:150,
        matchPct:100,direct:true,approximate:false,comparisonOnly:false}],
    });
  }
  const approved=planFinalRigidBatchCorrections(inventory,plans,{includeReviewOnly:true});
  assert.equal(approved.eligible.length,43);
  assert.equal(approved.skipped.length,14);
  assert.equal(approved.belowThreshold.length,87);
  const selection=planAllNearestBatchDraftSelection(inventory,plans,{});
  assert.equal(selection.selectedPointers.length,43);
  assert.equal(selection.hardHeld,14);
  assert.equal(selection.belowThreshold,87);
  const summary=summarizeFinalRigidBatch(selection.plan,selection.selectedPointers);
  assert.deepEqual([summary.corrected,summary.unchanged,summary.skipped,
    summary.unresolved,summary.warningRows],[43,87,14,14,144]);
  assert.equal(summary.engineeringMassApproval,'NOT_ESTABLISHED_BY_BATCH_REVIEW');
});


test('GLRD reported 19.1 mm pointers 15, 28, 35 accept source 2.984 kg as 29.84 CII units without physical owner authority',()=>{
  const pairs=[[15,46,459,10000],[28,85,829,10010],[35,101,939,10020]];
  const inventory={rows:pairs.map(([pointer,index,from,to])=>({
    rigidPointer:pointer,weight:17.48,rawWeight:'17.4800',status:'LINKED',
    linkedElements:[{index,fromNode:String(from),toNode:String(to),lengthMm:19.1}],
  }))};
  const plans=Array.from({length:35},()=>null);
  for(const [pointer] of pairs)plans[pointer-1]={
    sourceContext:{status:'NOT_RESOLVED',conflicts:['SOURCE_OWNER_UNVERIFIED'],
      ownerCandidates:[],bore:{value:50},rating:{value:900},dtxr:{suppressed:false}},
    mapping:null,nearestSuggestions:[],
  };
  const options={
    scope:'selected',selectedPointers:pairs.map(p=>p[0]),thresholdPct:40,
    includeReviewOnly:true,weightScale:10,
    manualReferences:new Map(pairs.map(([pointer])=>[pointer,{
      referenceWeight:'2.984',unit:'SOURCE_KG',documentRef:'OWNER-GLRD-11NOV',
      basis:'Owner-directed pointer-specific 19.1 mm review draft; physical owner unresolved',
    }])),
  };
  const plan=planFinalRigidBatchCorrections(inventory,plans,options);
  assert.deepEqual(plan.eligible.map(p=>p.pointer),[15,28,35]);
  for(const row of plan.eligible){
    assert.equal(row.proposedWeight,29.84);
    assert.equal(row.reviewRequired,true);
    assert.equal(row.candidate.manualEvidence.sourceKg,2.984);
    assert.equal(row.candidate.manualEvidence.weightScale,10);
    assert.equal(row.candidate.manualEvidence.engineeringMassApproval,'NOT_ESTABLISHED');
    assert.ok(row.warnings.includes('FINAL_POINTER_ONLY_SOURCE_OWNER_UNVERIFIED'));
  }
  const noScale=planFinalRigidBatchCorrections(inventory,plans,{...options,weightScale:null});
  assert.deepEqual(noScale.proposals.map(p=>p.skipCode),
    ['INVALID_MANUAL_REFERENCE','INVALID_MANUAL_REFERENCE','INVALID_MANUAL_REFERENCE']);
  const noBasis={...options,manualReferences:new Map([[15,{
    referenceWeight:'2.984',unit:'SOURCE_KG',documentRef:'X',basis:'unverified',
  }]])};
  assert.equal(planFinalRigidBatchCorrections(inventory,plans,noBasis)
    .proposals[0].skipCode,'INVALID_MANUAL_REFERENCE');
});

test('Owner pointer 35 #101 939→10020: 2.984kg nearest shows 29.84 instead of a false zero despite incomplete owner rationale',()=>{
  const target={
    rigidPointer:35,weight:17.48,rawWeight:'17.4800',status:'LINKED',
    linkedElements:[{index:101,fromNode:'939',toNode:'10020',lengthMm:19.1}],
  };
  const candidates=[
    {branchName:'/B',componentRefNo:'/PCOM-35',componentType:'PCOM',
      sourceNode:'939',side:'FROM',sourceLengthMm:12.7},
    {branchName:'/B',componentRefNo:'/FLANGE-35',componentType:'FLAN',
      sourceNode:'10020',side:'TO',sourceLengthMm:109},
  ];
  const context={
    status:'CONFLICT_REVIEW',ownerCandidates:candidates,
    conflicts:['COMPETING_SOURCE_COMPONENTS'],
    bore:{conflict:false},rating:{conflict:false},dtxr:{suppressed:false},
  };
  const plan={rigidPointer:35,mapping:null,sourceContext:context,
    nearestSuggestions:[{referenceWeight:29.84,masterWeightKg:2.984,
      matchPct:50,title:'SPECTACLE BLIND',method:'length-extrapolated',
      approximate:true,direct:false,comparisonOnly:true}]};
  const plans=Array.from({length:35},()=>null);plans[34]=plan;
  const selection=new Map([[35,{candidateIndex:0,rationale:''}]]);
  const allowed=planFinalRigidBatchCorrections({rows:[target]},plans,{
    includeReviewOnly:true,ownerSelections:selection,
  }).proposals[0];
  assert.equal(allowed.status,'ELIGIBLE');
  assert.equal(allowed.proposedWeight,29.84);
  assert.ok(Math.abs(allowed.errorPct)>40);
  assert.equal(allowed.reviewRequired,true);
  assert.equal(allowed.ownerResolution,null,
    'invalid source owner selection must NEVER gain physical mass authority');
  assert.ok(allowed.warnings.some(w=>w.startsWith('OWNER_SELECTION_UNQUALIFIED_REVIEW_ONLY')));
  assert.ok(allowed.warnings.includes('PHYSICAL_OWNER_CONFLICT_UNRESOLVED_FINAL_POINTER_DRAFT'));
  assert.equal(allowed.candidate.masterWeightKg,2.984);
  // Without review opt-in the same candidate is not silently eligible.
  assert.equal(planFinalRigidBatchCorrections({rows:[target]},plans,{
    ownerSelections:selection,
  }).proposals[0].status,'REVIEW_ONLY');
  // A real 109 mm competing-owner edge is still a hard hold, not relaxed
  // merely because a nearby short CII span can be reviewed.
  const flange={...target,linkedElements:[{index:101,fromNode:'939',
    toNode:'10020',lengthMm:109}]};
  const denied=planFinalRigidBatchCorrections({rows:[flange]},plans,{
    includeReviewOnly:true,ownerSelections:selection,
  }).proposals[0];
  assert.equal(denied.skipCode,'OWNER_SELECTION_INVALID');
});

test('quarantined engineering-HOLD CII can stage only acknowledged REVIEW-ONLY drafts, never approved source mass',()=>{
  const {inventory,plans}=witness();
  const withoutOptIn=planFinalRigidBatchCorrections(inventory,plans,{
    engineeringHold:true,includeReviewOnly:false,
  });
  assert.equal(withoutOptIn.eligible.length,0);
  assert.deepEqual(withoutOptIn.proposals.map(p=>p.status),
    ['REVIEW_ONLY','REVIEW_ONLY','REVIEW_ONLY']);
  const optedIn=planFinalRigidBatchCorrections(inventory,plans,{
    engineeringHold:true,includeReviewOnly:true,
  });
  assert.equal(optedIn.eligible.length,3);
  assert.ok(optedIn.eligible.every(p=>p.reviewRequired===true));
  assert.ok(optedIn.eligible.every(p=>
    p.warnings.includes('ENGINEERING_MASS_HOLD_REVIEW_ONLY_NOT_APPROVED')));
  assert.equal(summarizeFinalRigidBatch(optedIn,[1,2,3]).engineeringMassApproval,
    'NOT_ESTABLISHED_BY_BATCH_REVIEW');
});
