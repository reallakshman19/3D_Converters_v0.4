// Authentic GLRD final-CII editor proof. Reuse the existing independent
// native CII outputs (433 ELEMENTS, 144 RIGID records) from Phase 6 CI.
// The original run result must remain unchanged after property transactions.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {parseFinalCiiRigidInventory} from '../tabs/xml-cii-2019-standalone/xml-cii-final-rigid-inventory.js';
import {resolveField} from '../tabs/xml-cii-2019-standalone/xml-cii-final-property-reader.js';
import {
  createCiiPropertySession,stageCiiPropertyEdit,verifyCiiPropertyTransaction,ciiSha256,
} from '../tabs/xml-cii-2019-standalone/xml-cii-final-property-transactions.js';

const dir=resolve('artifacts/glrd-phase6-parity');
const first=readFileSync(resolve(dir,'phase6-reviewed-unchanged.cii'),'utf8');
const afterNative=readFileSync(resolve(dir,'phase6-reviewed-mass-edited.cii'),'utf8');
const originalHash=await ciiSha256(first);
const beforeInventory=parseFinalCiiRigidInventory(first);
const afterInventory=parseFinalCiiRigidInventory(afterNative);
assert.equal(beforeInventory.declared.elements,433);
assert.equal(beforeInventory.declared.rigids,144);
assert.equal(beforeInventory.rows.length,144);
assert.deepEqual(afterInventory.rows.map(r=>r.rigidPointer),
  beforeInventory.rows.map(r=>r.rigidPointer));
const changed=beforeInventory.rows.filter((row,i)=>
  Math.abs(row.weight-afterInventory.rows[i].weight)>1e-8);
assert.equal(changed.length,1);
const pointer=changed[0].rigidPointer;
const oldWeight=changed[0].weight;
const newWeight=afterInventory.rows[pointer-1].weight;
assert.equal(pointer,2,'GLRD verified reference pointer');
assert.equal(Math.round((newWeight-oldWeight)*1e5)/1e5,20);
assert.equal(oldWeight,590);
assert.equal(newWeight,610);

const runIdentity='GLRD-V04-FINAL-CII-REVIEW:'+originalHash;
const session=await createCiiPropertySession(first,{
  filename:'GLRD.cii',runIdentity,
});
const field=resolveField(session.index,session.registry.get('RIGID.weight'),pointer);
stageCiiPropertyEdit(session,{
  propertyId:'RIGID.weight',recordPointer:pointer,
  unit:'CII_OUTPUT_WEIGHT',newValue:String(newWeight),
  originalToken:field.originalToken,confirmed:true,
  reference:{kind:'explicit-owner-manual',source:'GLRD simulated 59→61kg'},
});
const patched=await verifyCiiPropertyTransaction(session,{
  currentCiiText:first,runIdentity,
});
const patchedInventory=parseFinalCiiRigidInventory(patched.revisedCiiText);
assert.equal(patchedInventory.rows[pointer-1].weight,newWeight);
assert.deepEqual(patchedInventory.rows.map((row,i)=>row.linkedElements.map(e=>[
  e.index,e.fromNode,e.toNode,e.lengthMm
])),beforeInventory.rows.map(row=>row.linkedElements.map(e=>[
  e.index,e.fromNode,e.toNode,e.lengthMm
])));
assert.deepEqual(patchedInventory.rows.map(r=>r.weight),
  afterInventory.rows.map(r=>r.weight));
assert.equal(patched.audit.changes.length,1);
assert.equal(patched.audit.changes[0].recordPointer,pointer);
assert.equal(patched.audit.changes[0].propertyId,'RIGID.weight');
assert.equal(await ciiSha256(first),originalHash,
  'original final CII run must remain immutable');
assert.equal(patched.audit.originalSha256,originalHash);
assert.notEqual(patched.audit.revisedSha256,originalHash);
const receipt={
  status:'PASS',
  sourceCommit:process.env.GITHUB_SHA||'local',
  originalCiiSha256:originalHash,
  editedCiiSha256:patched.audit.revisedSha256,
  sourceMassBeforeKg:59,sourceMassAfterKg:61,
  finalCiiPointer:pointer,
  rigidExportWeightBefore:oldWeight,rigidExportWeightAfter:newWeight,
  elementCount:beforeInventory.declared.elements,
  rigidCount:beforeInventory.declared.rigids,
  onlyRegisteredRigidWeightChanged:true,
  sourceCiiUnchanged:true,
  comparisonToActualNativeEdit:'WEIGHTS_AND_POINTERS_EQUAL',
  engineeringMassApproval:'SIMULATED_TEST_ONLY',
};
const path=resolve(dir,'v04-final-rigid-property-port-receipt.json');
mkdirSync(dirname(path),{recursive:true});
writeFileSync(path,JSON.stringify(receipt,null,2)+'\n');
console.log('GLRD_V04_FINAL_RIGID_PROPERTY_PASS',JSON.stringify(receipt));
