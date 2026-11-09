import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {formatModeARigidDtxrEvidenceTooltip}
  from '../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a.js';
import {explainRigidMassAudit}
  from '../tabs/xml-cii-2019-standalone/xml-cii-rigid-mass-audit-presentation.js';
import {runLogLevel}
  from '../tabs/xml-cii-2019-standalone/xml-cii-output-run-readiness.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('EF-05 staged DTXR description displays readable source location without rendering JSONPath',()=>{
  const title=formatModeARigidDtxrEvidenceTooltip({
    dtxr:'GASKET SPIRAL WOUND 300#',
    dtxrSourcePath:'$[187].children[43]',
  });
  assert.match(title,/GASKET SPIRAL WOUND 300#/);
  assert.match(title,/Class 300#/);
  assert.match(title,/comparison evidence ONLY/);
  assert.match(title,/branch 188, component 44/);
  assert.doesNotMatch(title,/\$\[187\]/);
  const alternate=formatModeARigidDtxrEvidenceTooltip({
    dtxr:'GASKET SPIRAL WOUND 300#',
    dtxrSourcePath:'${187}.children[43]',
  });
  assert.match(alternate,/branch 188, component 44/);
  const missing=formatModeARigidDtxrEvidenceTooltip({});
  assert.match(missing,/DTXR unavailable/);
  assert.match(missing,/No staged JSON source path/);
});

test('CII audit distinguishes 17 unique EF05 problems from 19 code findings',()=>{
  const rows=[];
  for(let pointer=1;pointer<=17;pointer++){
    const weighted=pointer===16;
    const between=pointer<=12;
    rows.push({
      element:pointer,pointer,rigidPointer:pointer,
      from:100+pointer,to:101+pointer,
      weightN:weighted?130:0,
      fromRef:between?'=SOURCE_A'+pointer:null,
      toRef:between?'=SOURCE_B'+pointer:null,
      flags:weighted
        ? ['PHYSICAL_OWNER_AMBIGUOUS','PHYSICAL_OWNER_UNRESOLVED',
           'WEIGHTED_CONNECTION_WITHOUT_PHYSICAL_OWNER']
        : ['PHYSICAL_OWNER_UNRESOLVED'],
    });
  }
  const flags=rows.flatMap(row=>row.flags.map(code=>({
    element:row.element,rigidPointer:row.rigidPointer,code,
    from:row.from,to:row.to,weightN:row.weightN,
  })));
  const audit={elementCount:616,auditedRigidCount:211,
    summary:{flaggedElements:17},rows,flags,
  };
  const summary=explainRigidMassAudit(audit);
  assert.deepEqual([
    summary.flaggedUnique,summary.flagRecords,summary.zeroWeightCount,
    summary.positiveWeightCount,summary.zeroBetweenDistinctRefs,
    summary.zeroNeedsNodeReconciliation,
  ],[17,19,16,1,12,4]);
  assert.equal(summary.engineeringMassVerified,false);
  assert.equal(summary.releasePolicy,'UNCHANGED_FAIL_CLOSED');
  assert.deepEqual(summary.weightedElements[0].reasons,[
    'PHYSICAL_OWNER_AMBIGUOUS','PHYSICAL_OWNER_UNRESOLVED',
    'WEIGHTED_CONNECTION_WITHOUT_PHYSICAL_OWNER']);
});

test('intentional bend-radius omission no longer appears as a converter error',()=>{
  assert.equal(runLogLevel('stderr: BEND_RADIUS_POLICY node=230 action=OMIT basis=toggle-off-caesar-default radius='),'info');
  assert.equal(runLogLevel('BEND_RADIUS_POLICY node=240 action=OMIT basis=toggle-off-caesar-default radius='),'info');
  assert.equal(runLogLevel('stderr: Traceback (most recent call last):'),'error');
  assert.equal(runLogLevel('stderr: converter failed'),'error');
  assert.equal(runLogLevel('warning: unsupported radius'),'warning');
});

test('Run routes unresolved source XML to Phase 6 and never opens duplicate legacy popup',()=>{
  const fast=read('tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-run-workflow-mode-a-fast.js');
  const single=read('tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-run-workflow-atta-default.js');
  const phase6=read('tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-phase6-unified-review.js');
  assert.match(fast,/RUN NOT STARTED/);
  assert.match(fast,/activePhaseId:'weight-match'/);
  assert.match(fast,/pendingPhase6MassReview/);
  assert.doesNotMatch(fast,/openModeAConsolidatedRigidWeightReviewPopup\(/);
  assert.match(fast,/if \(review\.cancelled\)/);
  assert.match(single,/if\(actual==='inputxml'\)return reviewInputXmlRigidWeights\(stateRef,config\)/);
  assert.match(single,/activePhaseId:'weight-match'/);
  assert.match(single,/pendingPhase6MassReview/);
  assert.match(single,/return false; \/\/ fail closed/);
  assert.match(single,/overrides\?\.rigidWeightSkipped/);
  assert.doesNotMatch(single.slice(single.indexOf('async function reviewRigidWeights(')),
    /openStandaloneRigidWeightReviewPopup\(/);
  assert.match(phase6,/data-phase6-run-redirect/);
  assert.match(phase6,/pendingPhase6MassReview:null/);
  assert.match(phase6,/openModeAConsolidatedRigidWeightReviewPopup\(pending,\{phase6:true\}\)/);
});

test('Output/Run diagnostic is labelled as audit HOLD and never releases CII by UI changes',()=>{
  const output=read('tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-output-run.js');
  const gate=read('converters/xml-cii2019-core/rigid-weight-empirical-audit.js');
  assert.match(output,/Distinct flagged elements/);
  assert.match(output,/Diagnostic findings \(may repeat an element\)/);
  assert.match(output,/Source FROM ref/);
  assert.match(output,/Source TO ref/);
  assert.match(output,/ZERO MASS: identity\/connection review/);
  assert.match(output,/POSITIVE MASS: owner review required/);
  assert.match(gate,/return \{\.\.\.output,ok:false,error,ciiText:'',ciiName:''/);
  assert.match(gate,/UNIQUE_ORIGINAL_COMPONENT_SPAN_CONFIRMED/);
  assert.match(gate,/sourceNodeGeometryRecovery/);
});
