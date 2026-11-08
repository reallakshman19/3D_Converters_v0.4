import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  applyPhase6SingleReview,applyPhase6ModeAReview,phase6ReviewSingleSourceId,phase6RuleSettingsOnly
} from '../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-phase6-unified-review.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sourceId=phase6ReviewSingleSourceId();

test('Phase 6 single XML review persists explicit masses, separate skip and receipts',()=>{
  const original={activePhaseId:'weight-match',supportConfigJson:JSON.stringify({
    overrides:{rigidWeight:{'A::9':19}},
  }),result:{ok:true},outputRunReadinessReport:{summary:{blockingCount:0}},
    masterContext:{config:{}}};
  const updated=applyPhase6SingleReview(original,{[sourceId]:{
    weightsByKey:{'A::10':46.343},
    skippedByKey:{'A::11':{skipped:true,weightKg:0}},
    reviewReceiptsByKey:{'A::10':{
      reviewed:true,reviewMethod:'EXPLICIT_BULK_OWNER_ATTESTATION',
      weightKg:46.343,sourceComponentRef:'=PI/BLIND',sourceEndpoint:'2'
    }},
  }});
  const cfg=JSON.parse(updated.supportConfigJson);
  assert.equal(cfg.overrides.rigidWeight['A::9'],19);
  assert.equal(cfg.overrides.rigidWeight['A::10'],46.343);
  assert.equal(cfg.overrides.rigidWeight['A::11'],undefined,
    '0kg skip must not become a physical mass');
  assert.equal(cfg.overrides.rigidWeightSkipped['A::11'].weightKg,0);
  assert.equal(cfg.overrides.rigidWeightReviewReceipts['A::10'].weightKg,46.343);
  assert.equal(cfg.overrides.rigidWeightReviewReceipts['A::10'].reviewMethod,
    'EXPLICIT_BULK_OWNER_ATTESTATION');
  assert.equal(updated.result,null);
  assert.equal(updated.outputRunReadinessReport,null);
  assert.equal(updated.activePhaseId,'weight-match');
  assert.equal(JSON.parse(original.supportConfigJson).overrides.rigidWeight['A::10'],undefined);
  assert.equal(updated.masterContext.config.overrides.rigidWeight['A::10'],46.343);
});

test('Phase 6 cannot approve an estimated mass with mismatched or false receipt',()=>{
  const state={supportConfigJson:'{}'};
  for(const receipt of [
    {reviewed:false,reviewMethod:'EXPLICIT_BULK_OWNER_ATTESTATION',weightKg:15},
    {reviewed:true,reviewMethod:'EXPLICIT_BULK_OWNER_ATTESTATION',weightKg:99},
    {reviewed:true,reviewMethod:'CATALOG_100_PERCENT',weightKg:15},
  ]){
    assert.throws(()=>applyPhase6SingleReview(state,{[sourceId]:{
      weightsByKey:{'B::1':15},reviewReceiptsByKey:{'B::1':receipt},
    }}),/Invalid physical mass review receipt/);
  }
});

test('Phase 6 Mode A keeps duplicate node identities isolated between source XMLs',()=>{
  const mk=id=>({sourceId:id,fileName:id+'.xml',enabled:true,
    sourceText:'<PipeStressExport></PipeStressExport>',supportConfigJson:'{}',
    workflow:{result:{ok:true},outputRunReadinessReport:{ready:true}}});
  const state={
    sourceKind:'xml',activePhaseId:'weight-match',
    sourceText:'<PipeStressExport></PipeStressExport>',
    supportConfigJson:'{}',
    sourceBatch:{mode:'separate-models',activeSourceId:'BM2-A',
      sources:[mk('BM2-A'),mk('BM2-B')]},
  };
  const updated=applyPhase6ModeAReview(state,{
    'BM2-A':{weightsByKey:{'B1::60':59}},
    'BM2-B':{weightsByKey:{'B1::60':13}},
  });
  const sources=updated.sourceBatch.sources;
  assert.equal(sources.length,2);
  assert.equal(JSON.parse(sources[0].supportConfigJson).overrides.rigidWeight['B1::60'],59);
  assert.equal(JSON.parse(sources[1].supportConfigJson).overrides.rigidWeight['B1::60'],13);
  assert.equal(sources[0].workflow.result,null);
  assert.equal(sources[1].workflow.result,null);
  assert.equal(updated.activePhaseId,'weight-match');
});

test('Phase 6 UI routes both single and Mode A to same consolidated review, without old table',()=>{
  const registry=read('tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-phase-registry.js');
  const single=read('tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-phase-panels.js');
  const batch=read('tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-phase-panels-mode-a.js');
  const unified=read('tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-phase6-unified-review.js');
  assert.match(registry,/id: 'weight-match', label: '6 Rigid Weight Review'/);
  assert.match(single,/if \(phaseId === 'weight-match'\) return renderUnifiedPhase6WeightReview/);
  assert.match(batch,/renderUnifiedPhase6WeightReview\(card, stateRef, render, \{modeA:true\}\)/);
  assert.match(unified,/openModeAConsolidatedRigidWeightReviewPopup\(pending\)/);
  assert.match(unified,/data-phase6-advanced/);
  assert.match(unified,/appendEmpiricalWeightValidationReport/);
  assert.match(unified,/mountXmlCiiWeightRuleSettings/);
  assert.doesNotMatch(unified,/Prefill all suggestions \(review\)|Commit verified weights/);
});

test('InputXML retains the pre-existing type-specific review route',()=>{
  const unified=read('tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-phase6-unified-review.js');
  assert.match(unified,/detectXmlCiiWorkflowSourceKind/);
  assert.match(unified,/sourceMode==='inputxml'/);
  assert.match(unified,/renderAdaptedWeightMatchPanelV2\(card,stateRef\)/);
  assert.match(unified,/xml-cii-adapted-weight-match-v2.js\?v=/);
});
test('Run readiness and propagation remain connected without the deprecated Weight Match UI',()=>{
  const readiness=read('tabs/xml-cii-2019-standalone/xml-cii-output-run-readiness.js');
  const propagation=read('tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-propagation-audit.js');
  const run=read('tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-run-workflow-mode-a-fast.js');
  assert.match(readiness,/physicalMassDecisions/);
  assert.match(readiness,/rigidWeightReviewReceipts/);
  assert.match(readiness,/explicitlySkippedZeroMasses/);
  assert.match(propagation,/explicit-phase6-source-override/);
  assert.match(run,/await consolidatedRigidReview\(/,
    'run must still independently recheck even if Phase 6 was never visited');
});

test('advanced settings reuse reference rules without sharing source-specific master data',()=>{
  const input={masterRows:[{DN:150,Rating:900,weight:59}],
    finalizedMatches:[{key:'B::1',weight:59}],
    valveHintLengthToleranceMm:6,convertSmallLengthsInToMm:true,
    semanticKeywordRules:[{code:'BALL',patterns:['BALL']}],
    specialValveFactorRules:[],
    valveHintMapping:[{type:'BALL',label:'Ball'}]};
  const shared=phase6RuleSettingsOnly(input);
  assert.equal(shared.masterRows,undefined);
  assert.equal(shared.finalizedMatches,undefined);
  assert.equal(shared.valveHintLengthToleranceMm,6);
  assert.equal(shared.convertSmallLengthsInToMm,true);
  assert.equal(shared.semanticKeywordRules.length,1);
});
test('replacing an old mass clears its stale receipt and prior explicit skip',()=>{
  const original={supportConfigJson:JSON.stringify({overrides:{
    rigidWeight:{'A::1':19},
    rigidWeightReviewReceipts:{'A::1':{reviewed:true,weightKg:19}},
    rigidWeightSkipped:{'A::1':{skipped:true,weightKg:0}},
  }})};
  const changed=applyPhase6SingleReview(original,{[sourceId]:{
    weightsByKey:{'A::1':21},
  }});
  const cfg=JSON.parse(changed.supportConfigJson);
  assert.equal(cfg.overrides.rigidWeight['A::1'],21);
  assert.equal(cfg.overrides.rigidWeightReviewReceipts['A::1'],undefined);
  assert.equal(cfg.overrides.rigidWeightSkipped['A::1'],undefined);
});
