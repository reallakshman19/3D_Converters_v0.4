import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEmpiricalWeightEstimator,
  estimateEmpiricalWeightNearestInterpolation,
  estimateEmpiricalWeight,
  evaluateEmpiricalWeightSandbox,
} from '../converters/empirical-weight/index.js';

const actual={typeDesc:'SPECTACLE BLIND',rating:300,target:'RF/RTJ KG'};
test('exact screenshot item remains 4 kg; published/default route is not changed',()=>{
  const exact=estimateEmpiricalWeightNearestInterpolation({...actual,ns:4});
  assert.equal(exact.ok,true);
  assert.equal(exact.approach,'EXACT');
  assert.equal(exact.weightKg,4);
  assert.equal(estimateEmpiricalWeight({...actual,ns:4}).weightKg,4);
});

test('NS 5 uses actual closest lower/upper SPECTACLE BLIND class 300 master entries',()=>{
  const estimate=estimateEmpiricalWeightNearestInterpolation({...actual,ns:5});
  assert.equal(estimate.ok,true,JSON.stringify(estimate));
  assert.equal(estimate.approach,'NEAREST_INTERPOLATED');
  assert.equal(estimate.confidence,'INTERPOLATED');
  assert.equal(estimate.weightKg,6.5); // NS4=4kg, NS6=9kg, halfway
  assert.equal(estimate.interpolation.method,'LINEAR_NS_BRACKET');
  assert.deepEqual([estimate.interpolation.lower.ns,estimate.interpolation.lower.weightKg],[4,4]);
  assert.deepEqual([estimate.interpolation.upper.ns,estimate.interpolation.upper.weightKg],[6,9]);
  assert.equal(estimate.interpolation.fraction,0.5);
  assert.equal(estimate.interpolation.lower.rating,300);
  assert.equal(estimate.interpolation.lower.typeDesc,'SPECTACLE BLIND');
  assert.equal(estimate.interpolation.lower.target,'RF/RTJ KG');
  assert.equal(estimate.authority,'ESTIMATE_ONLY_NOT_APPROVED_COMPONENT_MASS');
});

test('opt-in nearest-first follows exact; default published estimate stays unmodified',()=>{
  const est=createEmpiricalWeightEstimator();
  const input={...actual,ns:5};
  const original=est.estimate(input);
  assert.equal(original.ok,true);
  const nearest=est.estimate(input,{allowNearestInterpolation:true});
  assert.equal(nearest.weightKg,6.5);
  assert.equal(nearest.approach,'NEAREST_INTERPOLATED');
  assert.equal(est.estimate(input).weightKg,original.weightKg);
  assert.equal(est.estimate({...actual,ns:4},{allowNearestInterpolation:true}).approach,'EXACT');
});

test('strict lower and upper bounds: never perform one-sided nearest extrapolation',()=>{
  const below=estimateEmpiricalWeightNearestInterpolation({...actual,ns:1});
  const above=estimateEmpiricalWeightNearestInterpolation({...actual,ns:25});
  assert.equal(below.ok,false);
  assert.equal(above.ok,false);
  assert.equal(below.error.code,'NEAREST_BRACKET_UNAVAILABLE');
  assert.equal(above.error.code,'NEAREST_BRACKET_UNAVAILABLE');
});

test('unsupported component family, target or class must not substitute neighbours',()=>{
  const pcom=estimateEmpiricalWeightNearestInterpolation({
    typeDesc:'PCOM',ns:5,rating:300,target:'RF/RTJ KG'});
  assert.equal(pcom.ok,false);
  assert.equal(pcom.error.code,'UNKNOWN_TYPE_DESC');
  // No valid BW master cells for this family; never borrow RF/RTJ mass.
  const bw=estimateEmpiricalWeightNearestInterpolation({...actual,ns:5,target:'BW KG'});
  assert.equal(bw.ok,false);
  assert.equal(bw.error.code,'NEAREST_BRACKET_UNAVAILABLE');
  const unsupported=estimateEmpiricalWeightNearestInterpolation({...actual,ns:5,rating:12345});
  assert.equal(unsupported.ok,false);
  assert.equal(unsupported.error.code,'NEAREST_BRACKET_UNAVAILABLE');
});

test('nearest bracket interpolates only within the same class even with cross-class records nearby',()=>{
  const custom=[
    {TypeDesc:'Weldneck Flange',NS:2,DN:50,Rating:900,'RF/RTJ KG':15},
    {TypeDesc:'Weldneck Flange',NS:4,DN:100,Rating:900,'RF/RTJ KG':45},
    {TypeDesc:'Weldneck Flange',NS:3,DN:80,Rating:150,'RF/RTJ KG':1},
    {TypeDesc:'SPECTACLE BLIND',NS:3,DN:80,Rating:900,'RF/RTJ KG':999},
  ];
  const est=createEmpiricalWeightEstimator({masterRows:custom});
  const res=est.nearestInterpolation({typeDesc:'Weldneck Flange',ns:3,rating:900,target:'RF'});
  assert.equal(res.ok,true);
  assert.equal(res.weightKg,30);
  assert.deepEqual([res.interpolation.lower.ns,res.interpolation.upper.ns],[2,4]);
  const wrongClass=est.nearestInterpolation({typeDesc:'Weldneck Flange',ns:3,rating:300,target:'RF'});
  assert.equal(wrongClass.ok,false);
});

test('ambiguous duplicate master entries use existing median cell rule',()=>{
  const est=createEmpiricalWeightEstimator({masterRows:[
    {TypeDesc:'Weldneck Flange',NS:2,DN:50,Rating:900,'RF/RTJ KG':12},
    {TypeDesc:'Weldneck Flange',NS:2,DN:50,Rating:900,'RF/RTJ KG':18},
    {TypeDesc:'Weldneck Flange',NS:4,DN:100,Rating:900,'RF/RTJ KG':35},
  ]});
  const res=est.nearestInterpolation({typeDesc:'Weldneck Flange',ns:3,rating:900});
  assert.equal(res.weightKg,25);
  assert.equal(res.interpolation.lower.weightKg,15);
});

test('Sandbox shows new explicit nearest method while retaining active/candidate isolation',()=>{
  const sandbox=evaluateEmpiricalWeightSandbox({input:{...actual,ns:5}});
  assert.equal(sandbox.active.exact.ok,false);
  assert.equal(sandbox.active.nearest.ok,true);
  assert.equal(sandbox.active.nearest.weightKg,6.5);
  assert.equal(sandbox.active.finalNearest.approach,'NEAREST_INTERPOLATED');
  assert.equal(sandbox.active.finalNearest.weightKg,6.5);
  assert.equal(sandbox.active.final.ok,true);
  assert.equal(sandbox.candidate.nearest.weightKg,6.5);
  assert.equal(sandbox.delta.nearest.kg,0);
  assert.equal(sandbox.active.nearest.interpolation.lower.ns,4);
});

test('Invalid nominal sizes and rating fail closed',()=>{
  const est=createEmpiricalWeightEstimator();
  for(const value of [0,-1,'',NaN]){
    const r=est.nearestInterpolation({...actual,ns:value});
    assert.equal(r.ok,false);
  }
  assert.equal(est.nearestInterpolation({...actual,ns:5,rating:0}).ok,false);
});
