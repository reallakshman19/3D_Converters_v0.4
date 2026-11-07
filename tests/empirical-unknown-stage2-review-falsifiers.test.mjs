import assert from 'node:assert/strict';
import { isApprovedPhysicalMassCandidate } from '../converters/xml-cii2019-core/physical-mass-approval.js';
import { preferredWeightReviewDraft } from '../converters/xml-cii2019-core/weight-review-choices.js';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import {DEFAULT_WEIGHT_MASTER_ROWS} from '../converters/xml-cii2019-core/default-weight-master-rows.js';
import {rankXmlCiiWeightCandidates} from '../converters/xml-cii2019-core/weight-valve-hints.js';
import {applyXmlCiiFlangeWeightFallbackToIssue} from '../converters/xml-cii2019-core/flange-weight-fallback.js';
import {collectXmlCiiAutoRigidWeightsFromIssues}
  from '../converters/xml-cii2019-core/rigid-weight-auto-apply.js';
import {mappedNodeWeights}
  from '../tabs/xml-cii-2019-standalone/xml-cii-standalone-run-parity.js';

function issue(lengthMm,extra={}) {
  const config={weight:{masterRows:DEFAULT_WEIGHT_MASTER_ROWS}};
  const props={key:'B1::10020',branchName:'B1',nodeNumber:'10020',
    boreMm:50,rating:900,componentType:'PCOM',componentRefNo:'=TEST/UNKNOWN',
    lengthMm,elementLengthSource:'component-ref-endpoint-span',mapped:false,weight:0,...extra};
  // F01 deliberately injects an old UNCLASSIFIED ranked catalog suggestion
  // into a source PCOM/UNKNOWN record, then verifies that the Unknown
  // length-rule replaces it and no unapproved mass is ever applied.
  const ranking=rankXmlCiiWeightCandidates({
    boreMm:props.boreMm,rating:props.rating,lengthMm:props.lengthMm
  },config,{includeRejected:true});
  return {config,input:{...props,ranking,candidates:ranking.candidates.slice(0,5),
    rejectedCandidates:ranking.rejectedCandidates.slice(0,3)}};
}
function result(lengthMm,extra={}) {
  const {input,config}=issue(lengthMm,extra);
  return applyXmlCiiFlangeWeightFallbackToIssue(input,config);
}
test('F01: actual ranked 115mm 15.826kg overwritten with correct 15kg manual advisory',()=>{
  const raw=issue(115),ranked=raw.input.ranking.best;
  assert.ok(ranked,'must exercise real ranked path, not candidates:[] shortcut');
  const corrected=applyXmlCiiFlangeWeightFallbackToIssue(raw.input,raw.config);
  assert.equal(corrected.unknownComponentSuggestion.suggestedKg,15);
  assert.equal(corrected.candidates[0]?.selectedWeight,15);
  assert.equal(corrected.ranking.best?.selectedWeight,15);
  assert.equal(corrected.ranking.best?.preferred,false);
  assert.equal(corrected.ranking.best?.massAuthority,'ESTIMATE_ONLY_NOT_APPROVED_COMPONENT_MASS');
  assert.equal(corrected.ranking.best?.flangeWeightFallback,true);
  assert.equal(corrected.flangeWeightFallback,false);
  assert.equal(collectXmlCiiAutoRigidWeightsFromIssues([corrected]).appliedCount,0);
});
test('F03: 371.2mm may not use swing-check valve, nor flange reference',()=>{
  const r=result(371.2);
  assert.equal(r.unknownComponentSuggestion.referenceFamily,'Flanged Ball Valve-Reduced Bore');
  assert.equal(r.ranking.best?.referenceFamily,'Flanged Ball Valve-Reduced Bore');
  assert.equal(r.ranking.best?.selectedWeight,47.409);
  assert.equal(r.ranking.best?.preferred,false);
  assert.equal(r.ranking.best?.engineeringMassApproved,false);
  assert.equal(collectXmlCiiAutoRigidWeightsFromIssues([r]).appliedCount,0);
});
test('F09: route-only 763.4mm length cannot generate ranked mass',()=>{
  const r=result(763.4,{elementLengthSource:'computed-forward'});
  assert.deepEqual(r.candidates,[]);
  assert.equal(r.ranking.best,null);
  assert.equal(collectXmlCiiAutoRigidWeightsFromIssues([r]).appliedCount,0);
});
test('F02/F08: inferred fallback, non-preferred and no candidate refuse auto-apply',()=>{
  const implicit={...result(115),key:'B1::RIGID',componentRefNo:'=S'};
  assert.equal(collectXmlCiiAutoRigidWeightsFromIssues([implicit]).appliedCount,0);
  assert.equal(collectXmlCiiAutoRigidWeightsFromIssues([{key:'B1::EMPTY',candidates:[]}]).appliedCount,0);
  const fraud={...implicit,massAuthority:'APPROVED_SOURCE_MASS',
    candidates:[{...implicit.candidates[0],preferred:true,
      massAuthority:'APPROVED_SOURCE_MASS',acceptedForCii:true,
      engineeringMassApproved:true}]};
  assert.equal(collectXmlCiiAutoRigidWeightsFromIssues([fraud]).appliedCount,0,
    'inferred/fallback provenance must override forged approval flags');
  const approved={key:'B1::REAL',massAuthority:'APPROVED_SOURCE_MASS',
    candidates:[{selectedWeight:15,preferred:true,massAuthority:'APPROVED_SOURCE_MASS',
      acceptedForCii:true,engineeringMassApproved:true}]};
  const plan=collectXmlCiiAutoRigidWeightsFromIssues([approved]);
  assert.equal(plan.appliedCount,1);
  assert.equal(plan.weightsByKey['B1::REAL'],15);
});
test('F04: both Weight Match bulk controls cannot directly save an inferred catalog mass',()=>{
  for(const path of [
    'tabs/model-converters/converters/xmltocii2019_helper/weight-match-renderer.js',
    'tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-weight-match.js',
  ]){
    const src=readFileSync(new URL('../'+path,import.meta.url),'utf8');
    assert.match(src,/data-advisory-weight/);
    assert.match(src,/isApprovedPhysicalMassCandidate/);
    if(path.includes('weight-match-renderer.js')){
      assert.match(src,/stageDraft\\(input,preferredWeightReviewDraft\\(localIssues\\[index\\]\\)\\)/);
      assert.match(src,/if\\(estimateDraft && !verified\\) return false/);
      assert.match(src,/const fillBest = \\(\\) =>/);
      assert.doesNotMatch(src,/input\\.value = String\\(selectedWeight\\(best\\)\\); saveInput\\(input\\)/);
    }else{
      assert.match(src,/best\\.preferred !== true/);
      assert.match(src,/isApprovedPhysicalMassCandidate\\(best, selectedWeight\\(best\\)\\)/);
    }
  }
});
test('F02: standalone parity only maps explicit Owner overrides, never ranking auto mass',()=>{
  const s=readFileSync(new URL('../tabs/xml-cii-2019-standalone/xml-cii-standalone-run-parity.js',import.meta.url),'utf8');
  assert.match(s,/const weight = Number\.isFinite\(override\) && override > 0 \? override : null/);
  assert.doesNotMatch(s,/const auto = nr\.weightMatch/);
});
test('F07: missing-master behavior change remains visible, not described as unchanged output',()=>{
  const s=readFileSync(new URL('../converters/empirical-weight/empirical-weight-estimator.js',import.meta.url),'utf8');
  assert.match(s,/return \{ \.\.\.details, ok: false/);
});

test('F02 native helper: actual parity mass planner rejects inferred 23.803kg, keeps explicit override',()=>{
  const nodes=[{key:'B1::10020',branchName:'B1',nodeNumber:'10020',
    componentType:'RIGID',weightMatch:{weight:23.803,selectedWeight:23.803,
      inferredWeight:true,fallbackSuggestion:true,preferred:false}}];
  const none=mappedNodeWeights(nodes,{overrides:{rigidWeight:{}}});
  assert.equal(none.size,0,'preview-ranked estimate cannot be written into XML');
  const approved=mappedNodeWeights(nodes,{overrides:{rigidWeight:{'B1::10020':15}}});
  assert.equal(approved.size,1);
  assert.equal(approved.get('B1|10020'),15,'only explicit saved override reaches XML');
  const changedRoute=[{...nodes[0],lengthMm:763.4,
    weightMatch:{...nodes[0].weightMatch,weight:150}}];
  assert.equal(mappedNodeWeights(changedRoute,{overrides:{rigidWeight:{}}}).size,0,
    'route-gap perturbation cannot alter source weight');
});

test('F04 executable UI falsifier: proposal buttons stage drafts; no catalog mass is saved',()=>{
  const paths=[
    'tabs/model-converters/converters/xmltocii2019_helper/weight-match-renderer.js',
    'tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-weight-match.js',
  ];
  for(const path of paths){
    const src=readFileSync(new URL('../'+path,import.meta.url),'utf8');
    const marker='const fillBest = () => {';
    const start=src.indexOf(marker);
    assert.ok(start>=0,path);
    const end=src.indexOf('return count;',start);
    assert.ok(end>start,path);
    const body=src.slice(start+'const fillBest = '.length,end+'return count;'.length)+' }';
    for(const [candidate,oldExpected] of [
      [{selectedWeight:15,preferred:false},0],
      [{selectedWeight:15,preferred:true},0],
      [{selectedWeight:15,preferred:true,massAuthority:'APPROVED_SOURCE_MASS',
        inferredWeight:true},0],
      [{selectedWeight:15,preferred:true,massAuthority:'APPROVED_SOURCE_MASS',
        engineeringMassApproved:true,acceptedForCii:true},1],
    ]){
      let writes=0,stages=0;
      const input={value:'',getAttribute:()=> 'B1::10020'};
      const sandbox={
        localIssues:[{candidates:[candidate],mapped:false}],
        contentEl:{querySelectorAll:()=>[input]},
        selectedWeight:v=>v?.selectedWeight??v?.weight??0,
        isApprovedPhysicalMassCandidate,
        preferredWeightReviewDraft,
        stageDraft:(field,proposal)=>{
          if(!proposal)return false;
          field.value=String(proposal.weight);
          field.dataset={wmProposalDraft:proposal.approved?'approved':'estimate'};
          stages++;
          return true;
        },
        saveInput:()=>{writes++;},
        Number,String,
      };
      const fill=runInNewContext('('+body+')',sandbox);
      const result=fill();
      if(path.includes('weight-match-renderer.js')){
        assert.equal(result,1,'new UI should prefill review draft regardless of master approval score');
        assert.equal(stages,1);
        assert.equal(writes,0,'prefill must NEVER be a source-weight write');
      }else{
        assert.equal(result,oldExpected,path+' candidate '+JSON.stringify(candidate));
        assert.equal(writes,oldExpected,'legacy standalone must persist only approved sources');
      }
    }
  }
});

test('R2 F11: stale Weight Match cached rows from old auto-mapped ranking are not trusted',()=>{
  const text=readFileSync(new URL('../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-weight-match.js',import.meta.url),'utf8');
  assert.match(text,/xml-cii-wm-cache-v3-content-digest-source-authority/);
  assert.doesNotMatch(text,/xml-cii-wm-cache-v1/);
  assert.match(text,/sourceFactsIndex\(xmlText\)/);
  assert.match(text,/mapped: hasOverride \|\| sourceWeight>0/);
  assert.doesNotMatch(text,/mapped: hasOverride \|\| \(nr\.weightMatch/);
});
