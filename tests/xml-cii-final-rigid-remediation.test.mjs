import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFinalCiiRigidInventory} from '../tabs/xml-cii-2019-standalone/xml-cii-final-rigid-inventory.js';
import {buildFinalRigidRepairAssessments,orderFinalRigidReviewIndices} from '../tabs/xml-cii-2019-standalone/xml-cii-final-rigid-repair-assessment.js';
import {
  finalRigidReviewAvailable,finalRigidRepairReviewResult,
} from '../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-final-rigid-review.js';

function ciiline(values) {
  return values.map((v,i)=>String(v).padStart(i?13:15,' ')).join('');
}
function element(from,to,len,pointer){
  return [
    ciiline([from,to,len,0,0,60.3]),
    ...Array.from({length:11},()=>ciiline([0,0,0,0,0,0])),
    ciiline([0,pointer,0,0,0,0]),
    ciiline([0,0,0,0,0,0]),
    ciiline([0,0,0]),
  ].join('\r\n');
}
const fixture=[
  '#$ VERSION','2019','#$ CONTROL',
  ciiline([2,0,0,0,0,0]),
  ciiline([0,2,0,0,0,0]),
  ciiline([0,0,0,0,0,0]),
  ciiline([0]),
  '#$ ELEMENTS',
  element(1119,10020,19.1,1),
  element(10020,1120,109,2),
  '#$ RIGID',ciiline([150,'0.000000']),ciiline([150,'0.000000']),
].join('\r\n')+'\r\n';
const inv=parseFinalCiiRigidInventory(fixture);
const refs=[
  {rigidPointer:1,sourceContext:{
    status:'NOT_RESOLVED',mapping:null,reason:'PCOM owner awaits source confirmation',
    bore:{value:50},rating:{value:'900'},conflicts:[],
  }},
  {rigidPointer:2,sourceContext:{
    status:'VERIFIED',mapping:{componentRefNo:'=134234934/28064'},
    reason:'',conflicts:[],
  }},
];
const audit={
  schema:'xml-cii2019-rigid-empirical-ownership-audit/v2',status:'HOLD',
  flags:[
    {rigidPointer:1,element:1,from:1119,to:10020,lengthMm:19.1,
      weightN:150,physicalComponentRef:'=134234934/28062',
      code:'DUPLICATE_FULL_COMPONENT_MASS_ON_CONNECTION'},
    {rigidPointer:1,element:1,from:1119,to:10020,lengthMm:19.1,
      weightN:150,physicalComponentRef:'=134234934/28062',
      code:'POSITIVE_WEIGHT_ON_ZERO_MASS_COMPONENT'},
  ],
};
test('19.1mm final CII pointer 1 is prioritised but 109mm flange pointer 2 is not changed',()=>{
  const review=buildFinalRigidRepairAssessments(inv,refs,audit);
  assert.equal(review.summary.total,2);
  assert.equal(review.summary.repairNeeded,1);
  assert.equal(review.summary.auditFlagged,1);
  assert.equal(review.summary.shortSpan,1);
  const [short,flange]=review.rows;
  assert.deepEqual(short.affectedElements.map(x=>[x.fromNode,x.toNode,x.routeLengthMm]),
    [['1119','10020',19.1]]);
  assert.ok(short.issueCodes.includes('SHORT_SPAN_REVIEW'));
  assert.ok(short.issueCodes.includes('DUPLICATE_FULL_COMPONENT_MASS_ON_CONNECTION'));
  assert.ok(short.issueCodes.includes('POSITIVE_WEIGHT_ON_ZERO_MASS_COMPONENT'));
  assert.match(short.reasons.join(' '),/physical component length separately/);
  assert.equal(short.automaticMassApproval,false);
  assert.equal(flange.repairNeeded,false);
  assert.equal(flange.pointer,2);
  assert.equal(flange.automaticMassApproval,false);
  assert.deepEqual(inv.rows.map(x=>x.weight),[150,150],
    'review prioritisation must never change the original CII');
});
test('real source-audit failure outranks a short-only row without RIGID pointer renumbering',()=>{
  const flipped={...audit,flags:audit.flags.map(item=>({
    ...item,rigidPointer:2,element:2,from:10020,to:1120,lengthMm:109,
  }))};
  const issues=buildFinalRigidRepairAssessments(inv,refs,flipped);
  assert.deepEqual(orderFinalRigidReviewIndices(issues),[1,0]);
  assert.deepEqual(inv.rows.map(row=>row.rigidPointer),[1,2]);
});
test('short span alone triggers RECHECK, never physical owner or automatic weight',()=>{
  const result=buildFinalRigidRepairAssessments(inv,refs,null);
  assert.equal(result.summary.auditEvidence,'NOT_AVAILABLE');
  assert.equal(result.rows[0].shortSpan,true);
  assert.equal(result.rows[0].auditFlagged,false);
  assert.equal(result.rows[0].automaticMassApproval,false);
  assert.equal(result.rows[1].shortSpan,false);
  assert.throws(()=>buildFinalRigidRepairAssessments(inv,refs,null,{shortSpanReviewMm:0}),
    /Invalid short-span/);
});
test('only a flagged quarantined CII is reviewable; ordinary CII stays withheld',()=>{
  const held={
    ok:false,error:'RIGID_MASS_CONSERVATION_HOLD',ciiText:'',ciiName:'',
    rigidMassRepairCandidate:{
      status:'QUARANTINED_REVIEW_ONLY',ciiText:fixture,ciiName:'legacy.cii',
      engineeringReleaseAuthorized:false,
    },
    diagnostics:{rigidMassAudit:audit},
  };
  assert.equal(finalRigidReviewAvailable({result:held}),true);
  assert.equal(finalRigidReviewAvailable({running:true,result:held}),false);
  const review=finalRigidRepairReviewResult(held);
  assert.equal(review.ok,false,'repair view cannot turn HOLD into successful conversion');
  assert.equal(review.rigidMassReviewOnly,true);
  assert.equal(review.ciiText,fixture);
  assert.equal(held.ciiText,'','normal CII download must remain blocked');
  for(const changed of [
    {...held,error:'NOT_THE_MASS_HOLD'},
    {...held,rigidMassRepairCandidate:{...held.rigidMassRepairCandidate,status:'NOT_RUN'}},
    {...held,rigidMassRepairCandidate:{...held.rigidMassRepairCandidate,engineeringReleaseAuthorized:true}},
    {...held,diagnostics:{rigidMassAudit:{...audit,status:'NOT_RUN'}}},
    {...held,diagnostics:{rigidMassAudit:{...audit,flags:[]}}},
  ])assert.equal(finalRigidReviewAvailable({result:changed}),false);
});
