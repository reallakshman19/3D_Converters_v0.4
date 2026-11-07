import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createUnknownComponentLengthWeightSuggester,
  suggestUnknownComponentLengthWeight,
  UNKNOWN_COMPONENT_LENGTH_TOLERANCE_MM,
} from '../converters/empirical-weight/index.js';

const target={boreMm:50,rating:900,target:'RF/RTJ KG'};
const suggest=length=>suggestUnknownComponentLengthWeight({...target,componentLengthMm:length});

test('frozen user tolerance is 6mm',()=>{
  assert.equal(UNKNOWN_COMPONENT_LENGTH_TOLERANCE_MM,6);
  assert.throws(()=>createUnknownComponentLengthWeightSuggester({toleranceMm:5}),
    /TOLERANCE_FROZEN_6MM/);
});
test('19.1mm unknown uses exact 109mm / 15kg flange, never the entire 150N flange',()=>{
  const r=suggest(19.1);
  assert.equal(r.ok,true,JSON.stringify(r));
  assert.equal(r.selector,'FLANGE_REFERENCE');
  assert.equal(r.thresholdMm,115);
  assert.equal(r.referenceFamily,'Weldneck Flange');
  assert.equal(r.referenceLengthMm,109);
  assert.equal(r.referenceWeightKg,15);
  assert.equal(r.suggestedKg,2.628);
  assert.equal(r.method,'REFERENCE_LENGTH_PROPORTIONAL_HEURISTIC');
  assert.equal(r.massAuthority,'ESTIMATE_ONLY_NOT_APPROVED_COMPONENT_MASS');
  assert.equal(r.acceptedForCii,false);
  assert.equal(r.engineeringMassApproved,false);
  assert.equal(r.reference.status,'EXACT_MASTER');
  assert.equal(r.reference.anchors[0].boreMm,50);
});
test('109mm flange-size unknown uses flange reference 15kg',()=>{
  const r=suggest(109);
  assert.equal(r.selector,'FLANGE_REFERENCE');
  assert.equal(r.referenceWeightKg,15);
  assert.equal(r.suggestedKg,15);
});
test('long 371.2mm unknown uses 368mm / 47kg reduced bore ball valve',()=>{
  const r=suggest(371.2);
  assert.equal(r.ok,true,JSON.stringify(r));
  assert.equal(r.selector,'REDUCED_BORE_BALL_VALVE_REFERENCE');
  assert.equal(r.referenceFamily,'Flanged Ball Valve-Reduced Bore');
  assert.equal(r.referenceLengthMm,368);
  assert.equal(r.referenceWeightKg,47);
  assert.equal(r.suggestedKg,47.409);
  assert.equal(r.isExtrapolatedBeyondReferenceLength,true);
  assert.equal(r.acceptedForCii,false);
});
test('exact 115mm tolerance boundary uses 109mm / 15kg flange AS-IS, no interpolation',()=>{
  const boundary=suggest(115);
  assert.equal(boundary.ok,true);
  assert.equal(boundary.selector,'FLANGE_REFERENCE');
  assert.equal(boundary.thresholdMm,115);
  assert.equal(boundary.referenceFamily,'Weldneck Flange');
  assert.equal(boundary.reference.status,'EXACT_MASTER');
  assert.equal(boundary.referenceLengthMm,109);
  assert.equal(boundary.referenceWeightKg,15);
  assert.equal(boundary.suggestedKg,15);
  assert.equal(boundary.suggestedKgUnrounded,15);
  assert.equal(boundary.lengthRatio,1);
  assert.equal(boundary.method,'FLANGE_MASTER_AS_IS_AT_6MM_TOLERANCE');
  assert.equal(boundary.atFlangeToleranceBoundary,true);
  assert.equal(boundary.isExtrapolatedBeyondReferenceLength,false);
  assert.equal(boundary.engineeringMassApproved,false);
  assert.equal(boundary.acceptedForCii,false);
  const shorter=suggest(114.999);
  assert.equal(shorter.selector,'FLANGE_REFERENCE');
  assert.equal(shorter.atFlangeToleranceBoundary,false);
  assert.equal(shorter.method,'REFERENCE_LENGTH_PROPORTIONAL_HEURISTIC');
  const longer=suggest(115.001);
  assert.equal(longer.selector,'REDUCED_BORE_BALL_VALVE_REFERENCE');
  assert.equal(longer.atFlangeToleranceBoundary,false);
});
test('at tolerance boundary without an exact same-DN master, do not call DN interpolation as-is',()=>{
  const masterRows=[
    {TypeDesc:'Weldneck Flange',DN:50,Rating:900,length:100,'RF/RTJ KG':10},
    {TypeDesc:'Weldneck Flange',DN:100,Rating:900,length:200,'RF/RTJ KG':30},
  ];
  const boundary=createUnknownComponentLengthWeightSuggester({masterRows}).suggest({
    componentLengthMm:156,boreMm:75,rating:900,
  });
  assert.equal(boundary.ok,false);
  assert.equal(boundary.code,'EXACT_FLANGE_MASTER_REQUIRED_AT_TOLERANCE');
  assert.equal(boundary.acceptedForCii,false);
  assert.equal(boundary.flange.status,'DN_INTERPOLATED');
});

test('unknown DN interpolates BOTH reference weight and length across nearest DN master cells',()=>{
  const rows=[
    {TypeDesc:'Weldneck Flange',DN:50,Rating:900,length:100,'RF/RTJ KG':10},
    {TypeDesc:'Weldneck Flange',DN:100,Rating:900,length:200,'RF/RTJ KG':30},
    {TypeDesc:'Flanged Ball Valve-Reduced Bore',DN:50,Rating:900,length:320,'RF/RTJ KG':40},
    {TypeDesc:'Flanged Ball Valve-Reduced Bore',DN:100,Rating:900,length:420,'RF/RTJ KG':80},
    // Decoys to guarantee class, family and target isolation
    {TypeDesc:'Weldneck Flange',DN:75,Rating:150,length:5,'RF/RTJ KG':10000},
    {TypeDesc:'Flanged Ball Valve-Reduced Bore',DN:75,Rating:900,length:5,'BW KG':1000},
    {TypeDesc:'Blind Flange',DN:75,Rating:900,length:4,'RF/RTJ KG':1000},
  ];
  const s=createUnknownComponentLengthWeightSuggester({masterRows:rows}).suggest;
  const short=s({componentLengthMm:75,boreMm:75,rating:900});
  assert.equal(short.ok,true);
  assert.equal(short.reference.status,'DN_INTERPOLATED');
  assert.equal(short.reference.weightKg,20);
  assert.equal(short.reference.lengthMm,150);
  assert.deepEqual(short.reference.anchors.map(x=>x.boreMm),[50,100]);
  assert.equal(short.flange.lengthMm+6,156);
  assert.equal(short.suggestedKg,10);
  const long=s({componentLengthMm:185,boreMm:75,rating:900});
  assert.equal(long.selector,'REDUCED_BORE_BALL_VALVE_REFERENCE');
  assert.equal(long.reference.status,'DN_INTERPOLATED');
  assert.equal(long.reference.weightKg,60);
  assert.equal(long.reference.lengthMm,370);
  assert.equal(long.suggestedKg,30);
});
test('no nearest bore extrapolation and never borrow different rating/family',()=>{
  for(const r of [
    {componentLengthMm:120,boreMm:9999,rating:900},
    {componentLengthMm:120,boreMm:50,rating:12345},
  ]){
    const answer=suggestUnknownComponentLengthWeight(r);
    assert.equal(answer.ok,false);
    assert.equal(answer.code,'FLANGE_REFERENCE_NOT_QUALIFIED');
  }
  assert.equal(suggestUnknownComponentLengthWeight({componentLengthMm:0,boreMm:50,rating:900}).ok,false);
});
test('missing selected reduced-bore reference must fail, not fall back to flange mass',()=>{
  const masterRows=[{TypeDesc:'Weldneck Flange',DN:50,Rating:900,length:109,'RF/RTJ KG':15}];
  const s=createUnknownComponentLengthWeightSuggester({masterRows}).suggest;
  assert.equal(s({componentLengthMm:19.1,boreMm:50,rating:900}).suggestedKg,2.628);
  const missing=s({componentLengthMm:368,boreMm:50,rating:900});
  assert.equal(missing.ok,false);
  assert.equal(missing.code,'SELECTED_REFERENCE_NOT_QUALIFIED');
  assert.equal(missing.selector,'REDUCED_BORE_BALL_VALVE_REFERENCE');
});
test('same DN duplicates use median as existing empirical master catalog policy',()=>{
  const s=createUnknownComponentLengthWeightSuggester({masterRows:[
    {TypeDesc:'Weldneck Flange',DN:50,Rating:900,length:108,'RF/RTJ KG':14},
    {TypeDesc:'Weldneck Flange',DN:50,Rating:900,length:110,'RF/RTJ KG':16},
  ]}).suggest;
  const r=s({componentLengthMm:109,boreMm:50,rating:900});
  assert.equal(r.reference.weightKg,15);
  assert.equal(r.reference.lengthMm,109);
  assert.equal(r.reference.anchors[0].duplicateRows,2);
  assert.equal(r.suggestedKg,15);
});
test('no scenario authorizes automatic CII or XML source mass mutation',()=>{
  const s=createUnknownComponentLengthWeightSuggester().suggest;
  for(const L of [12.7,19.1,109,114.9,115.1,368,371.2,1000]){
    const r=s({componentLengthMm:L,boreMm:50,rating:900});
    if(r.ok){
      assert.equal(r.massAuthority,'ESTIMATE_ONLY_NOT_APPROVED_COMPONENT_MASS');
      assert.equal(r.engineeringMassApproved,false);
      assert.equal(r.acceptedForCii,false);
    }else assert.equal(r.acceptedForCii,false);
  }
});
