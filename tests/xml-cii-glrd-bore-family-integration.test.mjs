import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  rankXmlCiiWeightCandidates,
  classifySourceWeightFamily,
  isWeightMasterPhysicalFamilyMatch,
} from '../converters/xml-cii2019-core/weight-valve-hints.js';
import {isApprovedPhysicalMassCandidate} from '../converters/xml-cii2019-core/physical-mass-approval.js';

const masterRows = JSON.parse(readFileSync(new URL('../docs/Masters/wtValveweights.json',import.meta.url),'utf8'));
assert.equal(masterRows.length,1595,'Owner weight master row count must remain 1595');
const config={weight:{masterRows}};
const rank = (componentType,dtxr,boreMm, lengthMm,rating=900) =>
  rankXmlCiiWeightCandidates({componentType,dtxr,boreMm,lengthMm,rating},config,{includeRejected:true});
const positive = result => result.candidates.filter(x=>Number(x.selectedWeight ?? x.weight)>0);

test('real 2in 900# full-bore ball valve selects full-bore 56 kg, never reduced 47',()=>{
  const r=rank('VALV','BALL VALVE TRUNN FB FLGD 900#',50,368);
  assert.equal(Number(r.best?.selectedWeight),56);
  assert.match(String(r.best?.typeDesc),/full bore/i);
  assert.ok(positive(r).every(x=>/full bore/i.test(x.typeDesc)));
  assert.equal(isApprovedPhysicalMassCandidate(r.best,56),false,'catalog match is not engineering authority');
});
test('real 2in 900# reduced-bore valve selects 47 kg, never full-bore 56',()=>{
  const r=rank('VALV','BALL VALVE FLOAT RB FLGD 900#',50,368);
  assert.equal(Number(r.best?.selectedWeight),47);
  assert.ok(positive(r).every(x=>/reduced bore/i.test(x.typeDesc)));
});
test('a 2in 900# weldneck flange only uses a Weldneck Flange, 15 kg',()=>{
  const r=rank('RIGID','WELDING NECK FLANGE SCH 40S 900+1500#',50,109);
  assert.equal(Number(r.best?.selectedWeight),15);
  assert.equal(String(r.best?.typeDesc).toUpperCase(),'WELDNECK FLANGE');
  assert.ok(positive(r).every(x=>/weldneck/i.test(x.typeDesc)));
});
test('6in 900# weldneck flange at 147mm uses source DN150 not DN200 and 59kg',()=>{
  const r=rank('RIGID','WELDING NECK FLANGE SCH 80S 900#',150,147);
  assert.equal(Number(r.best?.selectedWeight),59);
  assert.equal(r.best?.candidateClass?.family,'FLANGE');
});
test('full bore and reduced bore extrapolations may never cross physical family',()=>{
  for(const [dtxr,trim] of [
    ['BALL VALVE TRUNN FB FLGD 900#','FULL_BORE'],
    ['BALL VALVE TRUNN RB FLGD 900#','REDUCED_BORE']]){
    for(const boreMm of [50,100,150,200]){
      const r=rank('VALV',dtxr,boreMm,610);
      assert.equal(classifySourceWeightFamily({componentType:'VALV',dtxr}).trim,trim);
      for(const candidate of positive(r))
        assert.equal(isWeightMasterPhysicalFamilyMatch(candidate,
          classifySourceWeightFamily({componentType:'VALV',dtxr})),true,
          `wrong-family bore ${boreMm}, ${dtxr}: ${candidate.typeDesc}`);
    }
  }
});
test('branch fitting flange must not receive a Weldneck or valve mass estimate',()=>{
  const r=rank('RIGID','BRANCH FITTING FLANGE SCH 40S 900+1500#',50,276);
  assert.equal(positive(r).length,0);
  assert.equal(r.physicalFamily.family,'BRANCH_FITTING');
});
test('blind flange cannot inherit spectacle-blind or valve identity',()=>{
  const r=rank('RIGID','BLIND FLANGE 900#',80,112.2);
  assert.ok(positive(r).every(x=>/blind flange/i.test(String(x.typeDesc))));
});
test('Unknown PCOM is not a master-approved physical mass',()=>{
  const r=rank('PCOM','',50,12.7);
  assert.equal(positive(r).length,0);
  assert.equal(r.physicalFamily.family,'UNKNOWN');
});
test('generic untyped ranking API keeps prior compatibility but has no mass approval',()=>{
  const r=rankXmlCiiWeightCandidates({boreMm:50,rating:900,lengthMm:109},config,{includeRejected:true});
  assert.ok(r.candidates.length>0);
  assert.equal(isApprovedPhysicalMassCandidate(r.best,r.best?.selectedWeight),false);
});
test('a flange exact +6mm preserves original master kg rather than scaling',()=>{
  const r=rank('RIGID','WELDING NECK FLANGE SCH 40S 900#',50,115);
  assert.equal(Number(r.best?.selectedWeight),15);
  assert.equal(r.best?.weightMethod,'flange-master-at-6mm-tolerance');
});
