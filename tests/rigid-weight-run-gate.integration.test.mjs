import assert from 'node:assert/strict';
import {runXmlCii2019WorkflowService}
  from '../tabs/xml-cii-2019-standalone/xml-cii-workflow-service.js';

// Real browser DOM parsing is covered by the separate browser qualification.
// This exercises the ACTUAL standalone Output/Run service boundary in Node:
// absent audit runtime must never publish generated CII.
const xml='<PipeStressExport><Pipe><Branch><Branchname>B1</Branchname></Branch></Pipe></PipeStressExport>';
const job={sourceKind:'xml',sourceText:xml,sourceName:'synthetic.xml',
  supportConfigJson:'{}',options:{outputMode:'cii-only',kgToNewton:true}};
let engineCalls=0;
const runtime={
  async runParityEnricher() { return {applied:true,xmlText:xml,
    evidence:{ok:true,engineInputDigest:'synthetic-test-only'},stats:{},logs:[]}; },
  async engineRunner() {
    engineCalls++;
    return {ok:true,sourceKind:'xml',ciiText:'#$ CONTROL\nnot a valid CII\n',
      ciiName:'synthetic.cii',enrichedText:xml,enrichedName:'synthetic-enriched.xml',
      diagnostics:{},logs:[]};
  },
};
const withheld=await runXmlCii2019WorkflowService(job,runtime);
assert.equal(engineCalls,1);
assert.equal(withheld.ok,false);
assert.equal(withheld.ciiText,'');
assert.equal(withheld.ciiName,'');
assert.equal(withheld.error,'RIGID_MASS_CONSERVATION_HOLD');
assert.equal(withheld.diagnostics.rigidMassCiiReleaseAuthorized,false);
assert.equal(withheld.diagnostics.rigidMassEngineeringQualified,false);
assert.equal(withheld.diagnostics.rigidMassAudit.status,'NOT_RUN');
assert.ok(withheld.diagnostics.rigidMassAudit.errorCode);
assert.equal(withheld.enrichedText,xml,'keep reviewed enriched XML when CII is held');

const missing=await runXmlCii2019WorkflowService(job,{
  runParityEnricher:runtime.runParityEnricher,
  engineRunner:async()=>({
    ok:true,sourceKind:'xml',ciiText:'',ciiName:'',
    enrichedText:xml,enrichedName:'synthetic-enriched.xml',
    diagnostics:{},logs:[]
  })
});
assert.equal(missing.ok,false);
assert.equal(missing.ciiText,'');
assert.equal(missing.diagnostics.rigidMassAudit.errorCode,'CII_OUTPUT_MISSING');
assert.equal(missing.diagnostics.rigidMassCiiReleaseAuthorized,false);

let blockedEngineCalls=0;
const parityBlocked=await runXmlCii2019WorkflowService(job,{
  async runParityEnricher() {return {applied:false,error:'SOURCE_PARITY_BLOCKED',logs:[]};},
  async engineRunner() {blockedEngineCalls++;throw Error('must not run');}
});
assert.equal(blockedEngineCalls,0);
assert.equal(parityBlocked.ok,false);
assert.equal(parityBlocked.error,'SOURCE_PARITY_BLOCKED');
assert.equal(parityBlocked.ciiText,null);
console.log('standalone Output/Run mass gate: 14 assertions PASS');
