import assert from 'node:assert/strict';
import { auditRigidWeightOwnership, parseCiiRigidElementWeights, holdDuplicateRigidMassOutput } from '../converters/xml-cii2019-core/rigid-weight-empirical-audit.js';

const section = (name, rows) => [`#$ ${name}`, ...rows].join('\n');
const row = (numbers) => numbers.join(' ');
const element = (from, to, dy, pointer, branch = 'B1') => {
  const lines = Array.from({ length: 15 }, () => '0 0 0 0 0 0');
  lines[0] = row([from, to, 0, dy, 0, 60.3]);
  lines[10] = `2 ${branch}`;
  lines[12] = row([0, pointer, 0, 0, 0, 0]);
  return lines.join('\n');
};
const cii = [section('CONTROL', ['2 0 0 0 0 0', '0 2 0 0 0 0', '0', '0']), section('ELEMENTS', [
  element(1119, 10020, 19.1, 1), element(10020, 1120, 109, 2),
]), section('RIGID', ['150 0', '150 0'])].join('\n');
const source = [
  {branch:'B1',nodeNumber:1119,ref:'=A/VALVE',endpoint:2,componentType:'VALV',weightKg:47},
  {branch:'B1',nodeNumber:10020,ref:'=A/FLANGE',endpoint:1,componentType:'FLAN',weightKg:15, rating:900,dn:50,dtxr:'WELDING NECK FLANGE SCH40'},
  {branch:'B1',nodeNumber:1120,ref:'=A/FLANGE',endpoint:2,componentType:'RIGID',weightKg:15,rating:900,dn:50,dtxr:'WELDING NECK FLANGE SCH40'},
];
const parsed = parseCiiRigidElementWeights(cii);
assert.equal(parsed.rigidCount, 2);
assert.deepEqual(parsed.elements.map(x => [x.from,x.to,x.rigidPointer,x.weightN,Math.round(x.lengthMm*10)/10]), [
  [1119,10020,1,150,19.1], [10020,1120,2,150,109],
]);
const requests = [];
const estimator = {estimate: request => {requests.push(request);return {ok:true,weightKg:15,modelId:'MASTER_CELL',approach:'EXACT',confidence:'EXACT'};}};
const audit = auditRigidWeightOwnership({ciiText:cii,xmlRows:source,estimator});
assert.deepEqual(audit.flags, [{element:1,from:1119,to:10020,code:'DUPLICATE_FULL_COMPONENT_MASS_ON_CONNECTION'}]);
assert.equal(audit.rows[0].empirical.status, 'API_NOT_APPLICABLE_CONNECTION');
assert.equal(audit.rows[1].physicalComponentRef, '=A/FLANGE');
assert.equal(audit.rows[1].empirical.status, 'API_ESTIMATE');
assert.deepEqual(requests, [{typeDesc:'Weldneck Flange',dn:50,rating:900,target:'RF/RTJ KG'}]);
const held = holdDuplicateRigidMassOutput({ok:true,ciiText:cii,ciiName:'GLRD.cii',diagnostics:{},logs:[]},audit);
assert.equal(held.ok,false);
assert.equal(held.ciiText,'');
assert.equal(held.error,'RIGID_MASS_CONSERVATION_HOLD');
const clean = cii.replace('150 0\n150 0', '0 0\n150 0');
assert.equal(auditRigidWeightOwnership({ciiText:clean,xmlRows:source,estimator}).flags.length,0);
assert.throws(() => parseCiiRigidElementWeights(cii.replace('0 1 0 0 0 0','0 9 0 0 0 0')), /CII_ELEMENT_INVALID/);
console.log('rigid-weight-empirical-audit: 11 assertions PASS');
