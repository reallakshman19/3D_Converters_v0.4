import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const version='20261108-rigid-choice-buttons-1';
const phase6Version='20261109-phase6-readable-table-r4';
const phase6ReviewVersion='20261109-ef05-dtxr-phase6-r5';
const finalReviewVersion='20261109-ef05-dtxr-phase6-r5';
const singlePreviewVersion='20261110-single-xml-preview-r1';
const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const chain=[
 ['index.html','main-rhbg-fitguard.js'],
 ['main-rhbg-fitguard.js','core/app.js'],
 ['core/app.js','app-standalone-runtime.js'],
 ['core/app-standalone-runtime.js','xml-cii-2019-standalone-tab.js'],
 ['tabs/xml-cii-2019-standalone-tab.js','xml-cii-adapted-workflow-shell-mode-a-easy-bulk-v6.js',singlePreviewVersion],
 // Phase 6 has been replaced; the legacy Weight Match renderer remains
 // available to independent non-UI consumers, not the active Phase 6 route.
 ['tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-workflow-shell-mode-a-easy-bulk-v6.js','xml-cii-adapted-events-mode-a-consolidated-review-v2.js',singlePreviewVersion],
 ['tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-events-mode-a-consolidated-review-v2.js','xml-cii-adapted-run-workflow-mode-a-fast.js',finalReviewVersion],
 ['tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-run-workflow-mode-a-fast.js','xml-cii-adapted-rigid-review-mode-a.js',phase6ReviewVersion],
 ['tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-run-workflow-mode-a-consolidated-review-v2.js','xml-cii-adapted-rigid-review-mode-a.js']
];
test('entire live XML-CII Weight Match and consolidated popup import chain is versioned',()=>{
  for(const [path,dependency,revision=version] of chain){
    const src=read(path);
    assert.ok(src.includes(dependency+'?v='+revision),
      path+' must load versioned '+dependency);
  }
});
test('new Phase 6 review and advanced matcher are versioned on the live import chain',()=>{
  const phase6Chain=[
    ['tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-workflow-shell-mode-a-easy-bulk-v6.js',
     'xml-cii-adapted-phase-panels-mode-a.js',singlePreviewVersion],
    ['tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-phase-panels-mode-a.js',
     'xml-cii-adapted-phase6-unified-review.js',phase6ReviewVersion],
    ['tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-phase-panels.js',
     'xml-cii-adapted-phase6-unified-review.js',phase6ReviewVersion],
    ['tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-phase6-unified-review.js',
     'xml-cii-adapted-rigid-review-mode-a.js',phase6ReviewVersion],
    ['tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-phase6-unified-review.js',
     'weight-match-renderer.js',phase6Version],
  ];
  for(const [path,dependency,revision] of phase6Chain)
    assert.ok(read(path).includes(dependency+'?v='+revision),
      path+' must load versioned '+dependency);
});

test('source-bore and strict physical-family ranking are used in both visible routes',()=>{
  const wm=read('tabs/model-converters/converters/xmltocii2019_helper/weight-match-renderer.js');
  const mode=read('tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a.js');
  for(const src of [wm,mode]){
    assert.match(src,/reconcileXmlCiiWeightMatchSourceBores\(/);
    assert.match(src,/rankXmlCiiWeightCandidates\(/);
    assert.match(src,/20261108-rigid-choice-buttons-1/);
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


test('final RIGID review and exact run-pinned output are versioned through both chains',()=>{
  const edits=[
    ['tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-phase-panels-mode-a.js',
     'xml-cii-adapted-phase-panels-smart.js'],
    ['tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-phase-panels-smart.js',
     'xml-cii-adapted-phase-panels.js'],
    ['tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-phase-panels.js',
     'xml-cii-adapted-output-run.js'],
    ['tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-output-run.js',
     'xml-cii-adapted-final-rigid-review.js'],
    ['tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-run-workflow-mode-a-fast.js',
     'xml-cii-adapted-run-workflow-atta-default.js'],
    ['tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-run-workflow-atta-default.js',
     'xml-cii-workflow-api-atta-default.js'],
    ['tabs/xml-cii-2019-standalone/xml-cii-workflow-api-atta-default.js',
     'xml-cii-workflow-service.js'],
  ];
  for(const [path,dependency] of edits)
    assert.ok(read(path).includes(dependency+'?v='+finalReviewVersion),
      path+' must load '+dependency+' at final-CII version '+finalReviewVersion);
});


test('Review Final weight opens the revised batch action/length modules, never cached obsolete code',()=>{
  const rev=finalReviewVersion;
  const editor=read('tabs/xml-cii-2019-standalone/xml-cii-final-property-editor-ui.js');
  const batchUi=read('tabs/xml-cii-2019-standalone/xml-cii-final-rigid-batch-ui.js');
  const planner=read('tabs/xml-cii-2019-standalone/xml-cii-final-rigid-batch-corrections.js');
  assert.ok(editor.includes('xml-cii-final-rigid-batch-ui.js?v='+rev));
  assert.ok(batchUi.includes('xml-cii-final-rigid-batch-corrections.js?v='+rev));
  assert.match(batchUi,/data-final-rigid-batch-apply-nearest/);
  assert.ok(batchUi.includes('Element Length (mm)'));
  assert.match(planner,/planAllNearestBatchDraftSelection/);
});


test('EF05 active Run uses the same versioned Phase 6 review and updated ownership audit',()=>{
  const rev=phase6ReviewVersion;
  const run=read('tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-run-workflow-mode-a-fast.js');
  const service=read('tabs/xml-cii-2019-standalone/xml-cii-workflow-service.js');
  assert.ok(run.includes('xml-cii-adapted-rigid-review-mode-a.js?v='+rev));
  assert.ok(service.includes('rigid-weight-empirical-audit.js?v='+rev));
  const panels=read('tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-phase-panels.js');
  assert.ok(panels.includes('xml-cii-adapted-phase6-unified-review.js?v='+rev));
  const phase6=read('tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-phase6-unified-review.js');
  assert.ok(phase6.includes('xml-cii-adapted-rigid-review-mode-a.js?v='+rev));
});
