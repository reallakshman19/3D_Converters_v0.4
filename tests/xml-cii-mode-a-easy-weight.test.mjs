import assert from 'node:assert/strict';
import { DEFAULT_WEIGHT_MASTER_ROWS } from '../converters/xml-cii2019-core/default-weight-master-rows.js';
import { rankXmlCiiWeightCandidates } from '../converters/xml-cii2019-core/weight-valve-hints.js';
import { isApprovedPhysicalMassCandidate } from '../converters/xml-cii2019-core/physical-mass-approval.js';
import { collectModeAApprovedPreferredChanges } from '../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-mode-a-weight-tools.js';
import { applyModeAWeightChanges } from '../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-mode-a-weight-actions.js';
import {
  buildModeAWeightFillPlan,
  buildModeAWeightProjectMatchPlan,
  buildModeAWeightUsePlan,
  modeAQualifiedExactWeightRow,
} from '../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-mode-a-bulk-weight.js';

const row=(overrides={})=>({
  sourceId:'SRC-A',fileName:'A.xml',branchName:'/B1',key:'B1::10020',
  componentType:'RIGID',componentRefNo:'=TEST/UNKNOWN',boreMm:50,rating:'900',lengthMm:109,
  bestWeight:15,bestScore:'100%',bestDescription:'Weldneck Flange',mapped:false,
  bestCandidate:null,...overrides
});
const approvedCandidate={
  selectedWeight:15,suggestedWeight:15,weight:15,preferred:true,
  massAuthority:'APPROVED_SOURCE_MASS',
  engineeringMassApproved:true,acceptedForCii:true,
  inferredWeight:false,fallbackSuggestion:false,flangeWeightFallback:false,
  zeroFallback:false,weightMethod:'source-verified',
};
const approved=(overrides={})=>row({bestCandidate:{...approvedCandidate},...overrides});

function stateRef(){
  return {current:{supportConfigJson:'{}',sourceBatch:{
    mode:'separate-models',activeSourceId:'SRC-A',sources:[
      {sourceId:'SRC-A',fileName:'A.xml',supportConfigJson:'{}',sourceText:''},
      {sourceId:'SRC-B',fileName:'B.xml',supportConfigJson:'{}',sourceText:''}
    ]}}};
}
function saved(ref,sourceId,key){
  const source=ref.current.sourceBatch.sources.find(s=>s.sourceId===sourceId);
  return JSON.parse(source.supportConfigJson||'{}')?.overrides?.rigidWeight?.[key];
}
// F13 reproducer: 100% catalog rank without approval is not physical mass.
const ranking=rankXmlCiiWeightCandidates({
  boreMm:50,rating:900,lengthMm:109,componentType:'RIGID',
  dtxr:'WELDING NECK FLANGE SCH 40S 900#',
}, {weight:{masterRows:DEFAULT_WEIGHT_MASTER_ROWS}},{includeRejected:true});
const master=ranking.candidates.find(c=>/weldneck flange/i.test(String(c.typeDesc||c.valveType||c.type||'')));
assert.ok(master,'actual master must contain Weldneck Flange evidence');
const score=Number(master.totalScore??master.score);
assert.ok(Number.isFinite(score),'original master ranking should have confidence evidence');
const catalog=row({bestWeight:master.selectedWeight??master.suggestedWeight??master.weight,
  bestDescription:master.typeDesc||'Weldneck Flange',bestScore:'100%',bestCandidate:master});
assert.equal(Number(catalog.bestWeight),15);
assert.equal(modeAQualifiedExactWeightRow(catalog),false,'100% master rank is not approval');
assert.equal(isApprovedPhysicalMassCandidate(master),false);
assert.equal(buildModeAWeightProjectMatchPlan([catalog]).changes.length,0);
assert.equal(buildModeAWeightUsePlan(catalog),null,'single-row Use must not offer confirm-to-approve');
assert.equal(buildModeAWeightFillPlan([catalog,row({key:'OTHER'})],catalog).changes.length,0);
assert.deepEqual(collectModeAApprovedPreferredChanges([catalog]),[],'normal bulk must not write');
assert.deepEqual(collectModeAApprovedPreferredChanges([
  {...catalog,_modeAWeightDtxrBest:{...master,preferred:true,totalScore:1}}
]),[],'DTXR rerank must not mint approval');
const ref=stateRef();
assert.equal(applyModeAWeightChanges(ref,[{sourceId:'SRC-A',key:catalog.key,weight:15,
  approvedCandidate:master}],'unsafe catalog'),false);
assert.equal(saved(ref,'SRC-A',catalog.key),undefined);

assert.equal(modeAQualifiedExactWeightRow(row()),false,'legacy 100% without metadata fails');
assert.equal(modeAQualifiedExactWeightRow(approved()),true);
assert.equal(modeAQualifiedExactWeightRow(approved({bestWeight:15.826})),false,
  'approved source mass must equal selected weight');
assert.equal(modeAQualifiedExactWeightRow(approved({bestScore:'50%'})),false);
assert.equal(modeAQualifiedExactWeightRow(approved({
  bestCandidate:{...approvedCandidate,inferredWeight:true}
})),false);
assert.equal(modeAQualifiedExactWeightRow(approved({
  bestCandidate:{...approvedCandidate,weightMethod:'length-interpolated'}
})),false);

const positive=[
  approved(),
  approved({sourceId:'SRC-B',fileName:'B.xml',key:'B1::20020'}),
  catalog,
  approved({sourceId:'SRC-C',key:'mapped',mapped:true}),
];
const project=buildModeAWeightProjectMatchPlan(positive);
assert.equal(project.changes.length,2);
assert.equal(project.review.length,1);
assert.equal(project.mapped.length,1);
assert.deepEqual(project.changes.map(c=>c.sourceId),['SRC-A','SRC-B']);
assert.ok(project.changes.every(c=>c.approvedCandidate?.massAuthority==='APPROVED_SOURCE_MASS'));
const fill=buildModeAWeightFillPlan(positive,positive[0]);
assert.equal(fill.changes.length,1);
assert.equal(fill.changes[0].sourceId,'SRC-B');
assert.equal(buildModeAWeightUsePlan(catalog),null);
assert.equal(buildModeAWeightUsePlan(positive[0]).requiresReview,false);
assert.equal(collectModeAApprovedPreferredChanges([positive[0]]).length,1);
assert.equal(collectModeAApprovedPreferredChanges([{
  ...positive[0],_modeAWeightDtxrBest:{...approvedCandidate,totalScore:1}
}]).length,1);
assert.deepEqual(collectModeAApprovedPreferredChanges([{
  ...positive[0],_modeAWeightDtxrBest:{...master,preferred:true,totalScore:1}
}]),[]);
const writer=stateRef();
assert.equal(applyModeAWeightChanges(writer,[...project.changes,{sourceId:'SRC-A',
  key:'unapproved',weight:15,approvedCandidate:master}],'atomic hold'),false);
assert.equal(saved(writer,'SRC-A',positive[0].key),undefined,
  'invalid row may not partially write a good row');
assert.equal(applyModeAWeightChanges(writer,project.changes,'approved exact source mass'),true);
assert.equal(saved(writer,'SRC-A',positive[0].key),15);
assert.equal(saved(writer,'SRC-B',positive[1].key),15);
console.log('xml-cii Mode A F13 actual-master, DTXR, use, fill, project and writer: PASS');
