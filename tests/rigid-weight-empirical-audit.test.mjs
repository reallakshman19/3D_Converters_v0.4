import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditRigidWeightOwnership,parseCiiRigidElementWeights,holdDuplicateRigidMassOutput}
  from '../converters/xml-cii2019-core/rigid-weight-empirical-audit.js';
import {explainRigidMassAudit}
  from '../tabs/xml-cii-2019-standalone/xml-cii-rigid-mass-audit-presentation.js';

const section=(name,lines)=>['#$ '+name,...lines].join('\n');
function element(e) {
  const rows=Array.from({length:15},()=> '0 0 0 0 0 0');
  rows[0]=[e.from,e.to,e.dx??0,e.dy??e.mm,e.dz??0,60.3].join(' ');
  rows[10]=e.branch.length+' '+e.branch;
  rows[12]=[0,e.pointer,0,0,0,0].join(' ');
  rows[14]='0 0 0';
  return rows;
}
function ciiText(edges) {
  const weights=edges.filter(e=>e.pointer>0).map(e=>e.weightN+' 0');
  return [section('CONTROL',[edges.length+' 0 0 0 0 0','0 '+weights.length+' 0 0 0 0',
    '0 0 0 0 0 0','0']),
    section('ELEMENTS',edges.flatMap(element)),section('RIGID',weights)].join('\n')+'\n';
}
function source(branch,nodeNumber,ref,endpoint,z,kg,type,extras={}) {
  return {branch,nodeNumber,ref,endpoint,position:[0,0,z],
    componentType:type,weightKg:kg,...extras};
}
const flangeInfo={rating:900,dn:50,dtxr:'WELDING NECK FLANGE SCH40 900#'};
const nodes=[],edges=[];
let pointer=0;
for(let i=0;i<14;i++) {
  const branch='CONN'+i,n=1000+i*10,flange='=F'+i,pcom='=P'+i;
  nodes.push(source(branch,n,'=V'+i,2,0,47,'VALV'));
  nodes.push(source(branch,-1,pcom,1,3.2,0,'PCOM'),
    source(branch,-1,pcom,2,15.9,0,'PCOM'));
  nodes.push(source(branch,n+1,flange,1,19.1,15,'FLAN',flangeInfo),
    source(branch,n+2,flange,2,128.1,15,'RIGID',flangeInfo));
  edges.push({from:n,to:n+1,mm:19.1,pointer:++pointer,weightN:150,branch});
  edges.push({from:n+1,to:n+2,mm:109,pointer:++pointer,weightN:150,branch});
}
for(let i=0;i<44;i++) {
  const branch='CONFLICT'+i,n=2000+i*10,ref='=C'+i;
  if(i===43)nodes.push(
    source(branch,n,'=OTHER_RIGID',1,0,0,'RIGID'),
    source(branch,n+8,ref,1,0,18.475,'FLAN',flangeInfo),
    source(branch,n+1,ref,2,109,15,'FLAN',flangeInfo));
  else nodes.push(source(branch,n,ref,1,0,18.475,'FLAN',flangeInfo),
    source(branch,n+1,ref,2,109,15,'FLAN',flangeInfo));
  edges.push({from:n,to:n+1,mm:109,pointer:++pointer,weightN:150,branch});
}
// Heavy short rigid: real ownership/mass, never reject solely on kg/mm.
const heavy=[
  source('HEAVY',9000,'=HV',1,0,110,'INST'),
  source('HEAVY',9001,'=HV',2,1.1,110,'INST')
];
nodes.push(...heavy);
edges.push({from:9000,to:9001,mm:1.1,pointer:++pointer,weightN:1100,branch:'HEAVY'});
const raw=ciiText(edges);
const parsed=parseCiiRigidElementWeights(raw);
assert.equal(parsed.elementCount,73);
assert.equal(parsed.rigidCount,73);
assert.deepEqual(parsed.elements.slice(0,2).map(x=>x.weightN),[150,150]);

const requests=[];
const estimator={estimate(request) {
  requests.push(request);
  return {ok:true,weightKg:15,modelId:'MASTER_CELL',approach:'EXACT',confidence:'EXACT'};
}};
const audit=auditRigidWeightOwnership({ciiText:raw,xmlRows:nodes,estimator});
assert.equal(audit.auditedRigidCount,73);
assert.equal(audit.summary.flagsByCode.DUPLICATE_FULL_COMPONENT_MASS_ON_CONNECTION,14);
assert.equal(audit.summary.flagsByCode.POSITIVE_WEIGHT_ON_ZERO_MASS_COMPONENT,14);
assert.equal(audit.summary.flagsByCode.SOURCE_ENDPOINT_WEIGHTS_CONFLICT,44);
assert.equal(audit.summary.flaggedElements,58);
assert.equal(audit.rows[0].physicalComponentRef,'=P0');
assert.equal(audit.rows[0].ownerType,'PCOM');
assert.equal(audit.rows[0].empirical.status,'API_NOT_APPLICABLE_CONNECTION');
assert.equal(audit.rows[1].physicalComponentRef,'=F0');
assert.equal(audit.rows[1].empirical.status,'API_ESTIMATE');
assert.deepEqual(requests[0],{typeDesc:'Weldneck Flange',dn:50,rating:900,target:'RF/RTJ KG'});
assert.equal(requests.length,58);
assert.deepEqual(audit.rows.find(x=>x.branch==='CONFLICT43').flags,
  ['SOURCE_ENDPOINT_WEIGHTS_CONFLICT']);
assert.deepEqual(audit.rows.find(x=>x.branch==='HEAVY').flags,[]);
assert.equal(audit.massVerified,false);
assert.equal(audit.status,'HOLD');
const output={ok:true,ciiText:raw,ciiName:'test.cii',diagnostics:{},logs:[]};
const held=holdDuplicateRigidMassOutput(output,audit);
assert.equal(held.ok,false);
assert.equal(held.ciiText,'');
assert.equal(held.rigidMassRepairCandidate.status,'QUARANTINED_REVIEW_ONLY');
assert.equal(held.rigidMassRepairCandidate.ciiText,raw,
  'unreleased CII is retained only as isolated, flagged repair source');
assert.equal(held.rigidMassRepairCandidate.engineeringReleaseAuthorized,false);
assert.equal(held.diagnostics.rigidMassEngineeringQualified,false);
assert.equal(held.diagnostics.rigidMassCiiReleaseAuthorized,false);
for(const invalid of [null,undefined,{status:'NOT_RUN',flags:[]},
  {...audit,status:'SOURCE_PARITY_ONLY_NOT_MASS_AUTHORITY',flags:[]},
  {...audit,schema:'wrong',flags:[]}])
  {
    const notQualified=holdDuplicateRigidMassOutput(output,invalid);
    assert.equal(notQualified.ciiText,'');
    assert.equal(notQualified.rigidMassRepairCandidate,null,
      'NOT_RUN/malformed/stale audits must never open a quarantined editor');
  }

const heavyCii=ciiText([{from:9000,to:9001,mm:1.1,pointer:1,weightN:1100,branch:'HEAVY'}]);
const clean=auditRigidWeightOwnership({ciiText:heavyCii,xmlRows:heavy,estimator});
assert.equal(clean.status,'SOURCE_PARITY_ONLY_NOT_MASS_AUTHORITY');
assert.equal(clean.massVerified,false);
assert.deepEqual(clean.flags,[]);
assert.equal(holdDuplicateRigidMassOutput({ok:true,ciiText:heavyCii},clean).ciiText,heavyCii);
const changedCii=heavyCii.replace('1100 0','1099 0');
assert.equal(holdDuplicateRigidMassOutput({ok:true,ciiText:changedCii},clean).ciiText,'',
  'stale audit cannot be applied to different output bytes');
const cleanZeroRows=[
  source('ZERO',7000,'=PCOM_ZERO',1,0,0,'PCOM'),
  source('ZERO',7001,'=PCOM_ZERO',2,12.7,0,'PCOM')
];
const cleanZeroCii=ciiText([{from:7000,to:7001,mm:12.7,pointer:1,weightN:0,branch:'ZERO'}]);
const cleanZero=auditRigidWeightOwnership({ciiText:cleanZeroCii,xmlRows:cleanZeroRows,estimator});
assert.equal(cleanZero.status,'SOURCE_PARITY_ONLY_NOT_MASS_AUTHORITY');
assert.equal(holdDuplicateRigidMassOutput({ok:true,ciiText:cleanZeroCii},cleanZero).ciiText,cleanZeroCii,
  'explicit zero mass structural rigid must remain available');
// GLRD-type connection: final ELEMENT 58 -> 59 carries a dedicated 0 N
// RIGID, but the two original XML nodes identify DIFFERENT physical refs.
// It is a nonphysical connecting segment; never invent a common component.
const zeroLinkBranch='ZERO_LINK';
const zeroLinkRows=[
  source(zeroLinkBranch,58,'=134234934/8043',2,0,0,'RIGID'),
  source(zeroLinkBranch,59,'=134234934/8045',1,10,0,'FLAN'),
];
const zeroLinkCii=ciiText([{from:58,to:59,mm:10,dy:0,dz:10,
  pointer:1,weightN:0,branch:zeroLinkBranch}]);
const zeroLink=auditRigidWeightOwnership({
  ciiText:zeroLinkCii,xmlRows:zeroLinkRows,estimator,
});
assert.equal(zeroLink.summary.flaggedElements,0,
  'genuine 0 N connector with two known source refs must not cause mass HOLD');
assert.equal(zeroLink.status,'SOURCE_PARITY_ONLY_NOT_MASS_AUTHORITY');
assert.equal(zeroLink.massVerified,false,'identity advisory cannot approve engineering mass');
assert.deepEqual(zeroLink.rows[0].flags,[]);
assert.deepEqual(zeroLink.rows[0].advisories,['ZERO_MASS_INTERCOMPONENT_CONNECTION']);
assert.equal(zeroLink.rows[0].physicalComponentRef,null,
  'connection must never acquire fabricated ownership');
assert.equal(zeroLink.rows[0].allocationBasis,
  'AUTHENTIC_DISTINCT_SOURCE_REFS_NO_PHYSICAL_SPAN');
assert.equal(zeroLink.advisories[0].fromRef,'=134234934/8043');
assert.equal(zeroLink.advisories[0].toRef,'=134234934/8045');
assert.equal(zeroLink.summary.advisoryElements,1);
const advisoryPresentation=explainRigidMassAudit(zeroLink);
assert.equal(advisoryPresentation.nonblockingZeroConnections,1);
assert.equal(advisoryPresentation.positiveWeightCount,0);
assert.equal(advisoryPresentation.flagRecords,0);
const zeroLinkOut=holdDuplicateRigidMassOutput({ok:true,ciiText:zeroLinkCii},zeroLink);
assert.equal(zeroLinkOut.ciiText,zeroLinkCii,
  'source-parity CII is available with a diagnostic warning');
assert.equal(zeroLinkOut.diagnostics.rigidMassEngineeringQualified,false);
assert.notEqual(zeroLinkOut.diagnostics.rigidMassCiiReleaseAuthorized,true);
const zeroLinkHeavyCii=ciiText([{from:58,to:59,mm:10,dy:0,dz:10,
  pointer:1,weightN:150,branch:zeroLinkBranch}]);
const positiveLink=auditRigidWeightOwnership({
  ciiText:zeroLinkHeavyCii,xmlRows:zeroLinkRows,estimator,
});
assert.ok(positiveLink.flags.some(f=>f.code==='PHYSICAL_OWNER_UNRESOLVED'));
assert.ok(positiveLink.flags.some(f=>f.code==='WEIGHTED_CONNECTION_WITHOUT_PHYSICAL_OWNER'));
assert.equal(positiveLink.advisories.length,0);
assert.equal(holdDuplicateRigidMassOutput({ok:true,ciiText:zeroLinkHeavyCii},positiveLink).ciiText,'',
  'a positive weight on the same unowned connector MUST remain held');
const missingZeroLink=auditRigidWeightOwnership({
  ciiText:zeroLinkCii,xmlRows:zeroLinkRows.slice(0,1),estimator,
});
assert.ok(missingZeroLink.flags.some(f=>f.code==='SOURCE_NODE_UNRESOLVED'));
assert.equal(missingZeroLink.advisories.length,0);
assert.equal(holdDuplicateRigidMassOutput({ok:true,ciiText:zeroLinkCii},missingZeroLink).ciiText,'',
  '0 N does not excuse a missing original source node');
const geometryMismatch=auditRigidWeightOwnership({
  ciiText:zeroLinkCii,
  xmlRows:zeroLinkRows.map(r=>r.nodeNumber===59?{...r,position:[0,0,11]}:r),
  estimator,
});
assert.ok(geometryMismatch.flags.some(f=>f.code==='CII_SOURCE_GEOMETRY_MISMATCH'));
assert.equal(geometryMismatch.advisories.length,0);
assert.equal(holdDuplicateRigidMassOutput({ok:true,ciiText:zeroLinkCii},geometryMismatch).ciiText,'',
  '0 N does not excuse source/CII geometry mismatch');
const sameRefZero=auditRigidWeightOwnership({
  ciiText:zeroLinkCii,
  xmlRows:zeroLinkRows.map(r=>({...r,ref:'=SAME',endpoint:1})),estimator,
});
assert.ok(sameRefZero.flags.some(f=>f.code==='PHYSICAL_OWNER_UNRESOLVED'));
assert.equal(sameRefZero.advisories.length,0);
const tamperedZero={
  ...zeroLink,
  rows:zeroLink.rows.map(row=>({...row,weightN:10})),
};
assert.equal(holdDuplicateRigidMassOutput({ok:true,ciiText:zeroLinkCii},tamperedZero).ciiText,'',
  'diagnostic exception must not survive fabricated nonzero audit-row mass');
const fakeAdvisory={
  ...zeroLink,advisories:[],
};
assert.equal(holdDuplicateRigidMassOutput({ok:true,ciiText:zeroLinkCii},fakeAdvisory).ciiText,'',
  'cannot discard warning evidence and pass a renamed status');
// EF-05-PRO.TEST original source flange: endpoint 1 has NodeNumber=-1,
 // while final CII assigns generated 7369; endpoint 2 is real node 7370.
 // A complete unique 86 mm flange span can be recovered geometrically,
 // without treating the generated number as a source component identity.
const efBranch='/ASIM-1836-4"-P8810031-31441C4-PP/B1';
const efRef='=1006649732/121030';
const efSource=[
  source(efBranch,-1,efRef,1,3,13,'FLAN'),
  source(efBranch,7370,efRef,2,89,13,'RIGID'),
];
const efCii=ciiText([{
  from:7369,to:7370,mm:86,dy:0,dz:86,
  pointer:1,weightN:130,branch:efBranch,
}]);
const efAudit=auditRigidWeightOwnership({
  ciiText:efCii,xmlRows:efSource,estimator,
});
assert.equal(efAudit.rows[0].physicalComponentRef,efRef);
assert.equal(efAudit.rows[0].ownerSpanMm,86);
assert.equal(efAudit.rows[0].sourceGeneratedEndpoint,'FROM');
assert.equal(efAudit.rows[0].sourceNodeGeometryRecovery,
  'UNIQUE_ORIGINAL_COMPONENT_SPAN_CONFIRMED');
assert.equal(efAudit.rows[0].fromRef,null,
  'generated CII node must never be fabricated as an original XML ref');
assert.equal(efAudit.rows[0].toRef,efRef);
assert.deepEqual(efAudit.rows[0].flags,[]);
assert.equal(efAudit.status,'SOURCE_PARITY_ONLY_NOT_MASS_AUTHORITY');
assert.equal(efAudit.massVerified,false);
assert.equal(holdDuplicateRigidMassOutput({ok:true,ciiText:efCii},efAudit).ciiText,
  efCii,'unique complete geometric identity can pass source parity, NOT engineering mass approval');
const efShifted=efSource.map(x=>x.endpoint===1
  ?{...x,position:[0,0,3.4]}:x);
const efWrong=auditRigidWeightOwnership({
  ciiText:efCii,xmlRows:efShifted,estimator,
});
assert.equal(efWrong.rows[0].physicalComponentRef,null);
assert.ok(efWrong.rows[0].flags.includes('PHYSICAL_OWNER_UNRESOLVED'),
  '0.4mm mismatch must not be accepted as physical owner');
assert.equal(holdDuplicateRigidMassOutput({ok:true,ciiText:efCii},efWrong).ciiText,'');
const efUnapprovedZero=auditRigidWeightOwnership({
  ciiText:efCii,xmlRows:efSource.map(x=>({...x,weightKg:0})),estimator,
});
assert.ok(efUnapprovedZero.rows[0].flags.includes('POSITIVE_WEIGHT_ON_ZERO_MASS_COMPONENT'),
  'geometric ownership is never positive physical-mass approval');
assert.ok(!efUnapprovedZero.rows[0].flags.includes('WEIGHTED_CONNECTION_WITHOUT_PHYSICAL_OWNER'),
  'a known physical zero-mass component must not be mislabeled ownerless');
const efAmbiguous=auditRigidWeightOwnership({
  ciiText:efCii,xmlRows:[...efSource,{...efSource[1]}],estimator,
});
assert.ok(efAmbiguous.rows[0].flags.includes('SOURCE_NODE_UNRESOLVED'),
  'duplicated genuine endpoint cannot anchor generated-node recovery');

const qualifiedApiSource=[
  source('API',6000,'=WELDNECK',1,0,15,'FLAN',flangeInfo),
  source('API',6001,'=WELDNECK',2,109,15,'RIGID',flangeInfo)
];
const qualifiedApiCii=ciiText([{from:6000,to:6001,mm:109,pointer:1,weightN:150,branch:'API'}]);
const productionApi=auditRigidWeightOwnership({ciiText:qualifiedApiCii,xmlRows:qualifiedApiSource});
assert.equal(productionApi.rows[0].empirical.status,'API_ESTIMATE');
assert.equal(productionApi.rows[0].empirical.weightKg,15,
  'production model built-in 2-inch Class 900 Weldneck Flange exact master cell');

const wrong=heavy.map(x=>x.nodeNumber===9001?{...x,position:[0,0,9]}:x);
assert.equal(auditRigidWeightOwnership({ciiText:heavyCii,xmlRows:wrong,estimator})
  .summary.flagsByCode.CII_SOURCE_GEOMETRY_MISMATCH,1);
assert.ok(auditRigidWeightOwnership({ciiText:heavyCii,xmlRows:heavy.slice(0,1),estimator})
  .flags.some(x=>x.code==='SOURCE_NODE_UNRESOLVED'));
assert.throws(()=>parseCiiRigidElementWeights(raw.replace('0 1 0 0 0 0','0 999 0 0 0 0')),
  /CII_ELEMENT_INVALID/);
assert.throws(()=>parseCiiRigidElementWeights(raw.replace('0 2 0 0 0 0','0 1 0 0 0 0')),
  /CII_RIGID_POINTER_DUPLICATE/);
assert.throws(()=>parseCiiRigidElementWeights(raw.replace('150 0','-1 0')),
  /CII_RIGID_WEIGHT_INVALID/);
assert.throws(()=>auditRigidWeightOwnership({ciiText:raw,xmlRows:[],estimator}),
  /XML_COMPONENT_POPULATION_EMPTY/);

if(process.env.GLRD_CII_PATH&&process.env.GLRD_SOURCE_ROWS_JSON) {
  const actual=auditRigidWeightOwnership({
    ciiText:readFileSync(process.env.GLRD_CII_PATH,'utf8'),
    xmlRows:JSON.parse(readFileSync(process.env.GLRD_SOURCE_ROWS_JSON,'utf8')),
    estimator:{estimate:()=>({ok:false,error:{code:'REAL_FIXTURE_API_NOT_RUN'}})}
  });
  assert.deepEqual([actual.elementCount,actual.rigidCount,actual.auditedRigidCount],[433,144,144]);
  assert.equal(actual.summary.flagsByCode.DUPLICATE_FULL_COMPONENT_MASS_ON_CONNECTION,14);
  assert.equal(actual.summary.flagsByCode.POSITIVE_WEIGHT_ON_ZERO_MASS_COMPONENT,14);
  assert.equal(actual.summary.flagsByCode.SOURCE_ENDPOINT_WEIGHTS_CONFLICT,44);
  const connection=actual.rows.find(x=>x.from===1119&&x.to===10020);
  assert.deepEqual([connection.rigidPointer,connection.weightN,
    Math.round(connection.lengthMm*10)/10,connection.ownerType],[40,150,19.1,'PCOM']);
  const physicalFlange=actual.rows.find(x=>x.from===10020&&x.to===1120);
  assert.deepEqual([physicalFlange.rigidPointer,physicalFlange.weightN,
    physicalFlange.sourceMassCandidateKg],[41,150,15]);
  assert.deepEqual(actual.rows.find(x=>x.from===3380&&x.to===3390).flags,
    ['SOURCE_ENDPOINT_WEIGHTS_CONFLICT']);
  console.log('REAL GLRD: PASS 433 elements, 144 rigids, 14 connection duplicates, 44 conflicts');
}else console.log('REAL GLRD: NOT_RUN (set GLRD_CII_PATH and GLRD_SOURCE_ROWS_JSON)');
console.log('rigid-weight-empirical-audit: synthetic tests PASS');
