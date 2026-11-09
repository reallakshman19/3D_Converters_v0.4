import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { finalRigidReviewAvailable } from '../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-final-rigid-review.js';
import { parseFinalCiiRigidInventory } from '../tabs/xml-cii-2019-standalone/xml-cii-final-rigid-inventory.js';
import {
  createCiiPropertySession, stageCiiPropertyEdit,
  verifyCiiPropertyTransaction,
} from '../tabs/xml-cii-2019-standalone/xml-cii-final-property-transactions.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const rev='20261109-final-cii-review-v035-r1';
const nativeRows=(from,to,pointer)=>[
  [from,to,0,0,0,100],
  ...Array.from({length:11},()=>[0,0,0,0,0,0]),
  [0,pointer,0,0,0,0],[0,0,0,0,0,0],[0,0,0],
].map(row=>row.join(' ')).join('\n');
const cii=[
  '#$ VERSION','2019','#$ CONTROL',
  '1 0 0 0 0 0','0 1 0 0 0 0','0 0 0 0 0 0','0',
  '#$ ELEMENTS',nativeRows(58,60,1),'#$ RIGID','590.000000 0',
].join('\r\n')+'\r\n';

test('final weight button only accepts released successful CII, never an audit HOLD',()=>{
  assert.equal(finalRigidReviewAvailable({}),false);
  assert.equal(finalRigidReviewAvailable({result:{ok:false,ciiText:cii}}),false);
  assert.equal(finalRigidReviewAvailable({result:{ok:true,ciiText:''}}),false);
  assert.equal(finalRigidReviewAvailable({result:{ok:true,ciiText:cii},running:true}),false);
  assert.equal(finalRigidReviewAvailable({result:{ok:true,ciiText:cii},running:false}),true);
  assert.equal(parseFinalCiiRigidInventory(cii).rows[0].weight,590);
});

test('explicit final 590N→610N patch changes only registered RIGID.weight and never original CII',async()=>{
  const pristine=cii;
  const session=await createCiiPropertySession(pristine,{
    filename:'GLRD.cii',runIdentity:'test-run-1',
  });
  stageCiiPropertyEdit(session,{propertyId:'RIGID.weight',recordPointer:1,value:610});
  const result=await verifyCiiPropertyTransaction(session,{
    currentCiiText:pristine,runIdentity:'test-run-1',
  });
  assert.equal(pristine,cii);
  assert.equal(result.revisedCiiText.includes('610'),true);
  const revised=parseFinalCiiRigidInventory(result.revisedCiiText);
  assert.equal(revised.rows[0].weight,610);
  assert.deepEqual(revised.rows[0].linkedElements.map(x=>[x.fromNode,x.toNode]),
    [['58','60']]);
  assert.equal(result.audit.changes.length,1);
  assert.equal(result.audit.changes[0].propertyId,'RIGID.weight');
  assert.notEqual(result.audit.originalSha256,result.audit.revisedSha256);
});

test('v0.4 run evidence, release hold, active-model binding and browser cache chain',()=>{
  const service=read('tabs/xml-cii-2019-standalone/xml-cii-workflow-service.js');
  const panel=read('tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-output-run.js');
  const modal=read('tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-final-rigid-review.js');
  const editor=read('tabs/xml-cii-2019-standalone/xml-cii-final-property-editor-ui.js');
  assert.match(service,/normalized\.finalRigidReviewEvidence\s*=/);
  assert.match(service,/engineInputText:\s*parity\.xmlText/);
  assert.match(service,/engineInputDigest:\s*parity\.evidence\.engineInputDigest/);
  assert.match(service,/return holdDuplicateRigidMassOutput\(normalized, audit\)/);
  assert.match(panel,/createFinalRigidWeightReviewButton\(state, \(\) => stateRef\.current\?\.result\)/);
  assert.match(panel,/finalRigidPrerequisite/);
  assert.match(modal,/parseFinalCiiRigidInventory\(result\.ciiText\)/);
  assert.match(modal,/getCurrentResult/);
  assert.match(editor,/verifyCiiPropertyTransaction/);
  assert.match(editor,/current\(\) !== result/);
  assert.match(editor,/Download Revised CII/);
  assert.match(editor,/Apply Changes & Re-extract CII/);
  assert.match(editor,/Download Change Audit JSON/);
  assert.match(read('tabs/xml-cii-2019-standalone-tab.js'),new RegExp(rev));
  assert.match(read('tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-phase-panels.js'),
    new RegExp('xml-cii-adapted-output-run\\.js\\?v='+rev));
  assert.match(read('tabs/xml-cii-2019-standalone/xml-cii-workflow-api-atta-default.js'),
    new RegExp('xml-cii-workflow-service\\.js\\?v='+rev));
});
