import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const version='20261107-glrd-bore-family-r2';
const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const chain=[
 ['index.html','main-rhbg-fitguard.js'],
 ['main-rhbg-fitguard.js','core/app.js'],
 ['core/app.js','app-standalone-runtime.js'],
 ['core/app-standalone-runtime.js','xml-cii-2019-standalone-tab.js'],
 ['tabs/xml-cii-2019-standalone-tab.js','xml-cii-adapted-workflow-shell-mode-a-easy-bulk-v6.js'],
 ['tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-workflow-shell-mode-a-easy-bulk-v6.js','xml-cii-adapted-phase-panels-mode-a.js'],
 ['tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-phase-panels-mode-a.js','xml-cii-adapted-weight-match-v2.js'],
 ['tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-weight-match-v2.js','weight-match-renderer.js'],
 ['tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-workflow-shell-mode-a-easy-bulk-v6.js','xml-cii-adapted-events-mode-a-consolidated-review-v2.js'],
 ['tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-events-mode-a-consolidated-review-v2.js','xml-cii-adapted-run-workflow-mode-a-fast.js'],
 ['tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-run-workflow-mode-a-fast.js','xml-cii-adapted-rigid-review-mode-a.js'],
 ['tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-run-workflow-mode-a-consolidated-review-v2.js','xml-cii-adapted-rigid-review-mode-a.js']
];
test('entire live XML-CII Weight Match and consolidated popup import chain is versioned',()=>{
  for(const [path,dependency] of chain){
    const src=read(path);
    assert.ok(src.includes(dependency+'?v='+version),
      path+' must load versioned '+dependency);
  }
});
test('source-bore and strict physical-family ranking are used in both visible routes',()=>{
  const wm=read('tabs/model-converters/converters/xmltocii2019_helper/weight-match-renderer.js');
  const mode=read('tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a.js');
  for(const src of [wm,mode]){
    assert.match(src,/reconcileXmlCiiWeightMatchSourceBores\(/);
    assert.match(src,/rankXmlCiiWeightCandidates\(/);
    assert.match(src,/20261107-glrd-bore-family-r2/);
  }
});
test('normal evidence remains advisory, explicit approval gate and PCOM path stay intact',()=>{
  const m=read('tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a.js');
  assert.match(m,/data-mode-a-rigid-apply-suggestions/);
  assert.match(m,/rigidReviewProposalNeedsVerification\(input\)/);
  assert.match(m,/isApprovedPhysicalMassCandidate/);
  const native=read('converters/scripts/xml_to_cii2019_pcom_mass.py');
  assert.match(native,/CII_PCOM_RIGID_POINTER_REUSED/);
  assert.match(native,/SAVED_EXPLICIT_PCOM_REVIEW_ONLY/);
});
