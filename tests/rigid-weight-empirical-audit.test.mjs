import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditRigidWeightOwnership,parseCiiRigidElementWeights,holdDuplicateRigidMassOutput}
  from '../converters/xml-cii2019-core/rigid-weight-empirical-audit.js';

const section=(name,lines)=>['#$ '+name,...lines].join('\n');
function element(e) {
  const rows=Array.from({length:15},()=> '0 0 0 0 0 0');
  rows[0]=[e.from,e.to,0,e.mm,0,60.3].join(' ');
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
