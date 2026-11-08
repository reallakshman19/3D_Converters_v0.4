import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WEIGHT_MASTER_ROWS } from '../converters/xml-cii2019-core/default-weight-master-rows.js';
import { rankXmlCiiWeightCandidates } from '../converters/xml-cii2019-core/weight-valve-hints.js';
import { applyXmlCiiFlangeWeightFallbackToIssue } from '../converters/xml-cii2019-core/flange-weight-fallback.js';
import {
  proposedRigidReviewWeight,stageRigidReviewProposal,clearRigidReviewProposal,
  rigidReviewProposalNeedsVerification,
  isRigidWeightReviewEligibleIssue,
} from '../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-prefill.js';
import {readFileSync} from 'node:fs';

const cfg={weight:{masterRows:DEFAULT_WEIGHT_MASTER_ROWS}};
const issue=(overrides={})=>({
  componentType:'RIGID', reviewCategory:'RIGID',
  boreMm:50, rating:900, lengthMm:109, dtxr:'WELDING NECK FLANGE SCH 80S 900#',
  elementLengthSource:'component-ref-endpoint-span', mapped:false, weight:0,
  ...overrides,
});
function ranked(extra={}) {
  const row=issue(extra);
  const r=rankXmlCiiWeightCandidates(row,cfg,{includeRejected:true});
  return applyXmlCiiFlangeWeightFallbackToIssue({...row,candidates:r.candidates,ranking:r},cfg);
}
test('qualified actual master known-flange advisory produces review draft, never approval',()=>{
  const proposal=proposedRigidReviewWeight(ranked());
  assert.ok(proposal,'genuine Weldneck Flange master candidate expected');
  assert.equal(proposal.approved,false);
  assert.equal(proposal.reference.toUpperCase().includes('FLANGE'),true);
  assert.ok(proposal.weight>0);
});
test('full bore valve cannot be copied from wrong-family flange or reduced-bore candidate',()=>{
  const row=issue({dtxr:'VALVE TRUNN FULL BORE 900#',lengthMm:610,
    candidates:[{weight:461,selectedWeight:461,weightMethod:'master',
      typeDesc:'Weldneck Flange',candidateClass:{family:'FLANGE'},rowBore:50,rowRating:900}]});
  assert.equal(proposedRigidReviewWeight(row),null);
});
test('PCOM Unknown physical 19.1mm uses advisory sidecar but not route-length pseudo mass',()=>{
  const row=issue({componentType:'PCOM',reviewCategory:'UNKNOWN',dtxr:'',lengthMm:19.1});
  const normal=applyXmlCiiFlangeWeightFallbackToIssue({...row,candidates:[]},cfg);
  const proposal=proposedRigidReviewWeight(normal);
  assert.equal(proposal.weight,2.628);
  assert.equal(proposal.approved,false);
  assert.equal(proposedRigidReviewWeight({...normal,elementLengthSource:'computed-forward'}),null);
});
test('unknown HOLD or missing source evidence cannot prefill',()=>{
  assert.equal(proposedRigidReviewWeight(issue({componentType:'PCOM',reviewCategory:'UNKNOWN',
    unknownComponentSuggestion:{ok:false,code:'NO_REFERENCE'}})),null);
  assert.equal(proposedRigidReviewWeight(issue({componentType:'PCOM',reviewCategory:'UNKNOWN',
    unknownComponentSuggestion:{ok:true,suggestedKg:15,referenceFamily:'Weldneck Flange'},
    elementLengthSource:'computed-forward'})),null);
});
test('approved source mass may prefill, synthetic catalog 100% cannot mint approval',()=>{
  const base={typeDesc:'Weldneck Flange',weight:15,selectedWeight:15,preferred:true,
    massAuthority:'APPROVED_SOURCE_MASS',engineeringMassApproved:true,acceptedForCii:true,
    inferredWeight:false,fallbackSuggestion:false,zeroFallback:false,weightMethod:'source-verified'};
  assert.equal(proposedRigidReviewWeight(issue({candidates:[base]})).approved,true);
  assert.equal(proposedRigidReviewWeight(issue({candidates:[{...base,engineeringMassApproved:false}]})).approved,false);
});
test('proposed estimate remains blocked until reviewed checkbox; editing clears proposal',()=>{
  const verified={checked:false,disabled:false};
  const input={value:'',dataset:{},style:{},title:'',
    closest:()=>({querySelector:()=>verified})};
  assert.equal(stageRigidReviewProposal(input,{weight:15,approved:false,reference:'Weldneck Flange'}),true);
  assert.equal(input.value,'15');
  assert.equal(rigidReviewProposalNeedsVerification(input),true);
  verified.checked=true;
  assert.equal(rigidReviewProposalNeedsVerification(input),false);
  clearRigidReviewProposal(input);
  assert.equal(rigidReviewProposalNeedsVerification(input),false);
  assert.equal(verified.checked,false);
  stageRigidReviewProposal(input,{weight:15,approved:true,reference:'Approved source mass'});
  assert.equal(verified.disabled,true);
  assert.equal(rigidReviewProposalNeedsVerification(input),false);
});
test('both standalone variants and Mode A expose bulk drafts and fail-closed review gate',()=>{
  for(const file of [
    'xml-cii-adapted-run-workflow.js','xml-cii-adapted-run-workflow-atta-default.js',
    'xml-cii-adapted-rigid-review-mode-a.js']) {
    const src=readFileSync(new URL('../tabs/xml-cii-2019-standalone/ui-adapted/'+file,import.meta.url),'utf8');
    assert.match(src,/Apply All Suggestions/,file);
    if(file.includes('mode-a')){
      assert.doesNotMatch(src,/data-rigid-suggestion-verified/,file);
      assert.match(src,/data-mode-a-rigid-bulk-attest/,file);
      assert.match(src,/EXPLICIT_BULK_OWNER_ATTESTATION/,file);
    } else assert.match(src,/data-rigid-suggestion-verified/,file);
    assert.match(src,/rigidReviewProposalNeedsVerification\(input\)/,file);
    assert.match(src,/stageRigidReviewProposal\(input/,file);
    assert.doesNotMatch(src,/massAuthority:\s*'APPROVED_SOURCE_MASS'/,file);
  }
});

test('physical rigid review excludes OLET/TEE/GASK despite valve-like DTXR text',()=>{
  for(const componentType of ['OLET','TEE','GASK','ELBO','BRAN','REDU']){
    assert.equal(isRigidWeightReviewEligibleIssue({componentType,dtxr:'VALVE FLANGED'}),false,componentType);
  }
  for(const componentType of ['FLAN','RIGID','PCOM','VALV','INST']){
    assert.equal(isRigidWeightReviewEligibleIssue({componentType}),true,componentType);
  }
});

test('consolidated no-checkbox mode remains blocked until explicit batch review method',()=>{
  const input={value:'15',dataset:{},style:{},title:'',
    closest:()=>({querySelector:()=>null})};
  assert.equal(stageRigidReviewProposal(input,{weight:15,approved:false,reference:'catalog'}),true);
  assert.equal(rigidReviewProposalNeedsVerification(input),true);
  input.dataset.rigidReviewMethod='EXPLICIT_BULK_OWNER_ATTESTATION';
  assert.equal(rigidReviewProposalNeedsVerification(input),false);
  clearRigidReviewProposal(input);
  assert.equal(rigidReviewProposalNeedsVerification(input),false);
  stageRigidReviewProposal(input,{weight:15,approved:false,reference:'changed candidate'});
  assert.equal(rigidReviewProposalNeedsVerification(input),true,
    'new candidate must invalidate old whole-batch confirmation');
});
