// Authentic Owner GLRD inputs, new Phase 6 screen, and the SAME consolidated
// mass gate used before Run. This is a UI/authority simulation, not independent
// engineering verification of the 109 empirical masses.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const folder=process.env.GLRD_INPUT_DIR||'/tmp/glrd-inputs';
const out=resolve('artifacts/glrd-phase6-parity');
await mkdir(out,{recursive:true});
const [xml,stage,masterRows]=await Promise.all([
  readFile(resolve(folder,'GLRD-1000-PI-01 - BM2.xml'),'utf8'),
  readFile(resolve(folder,'STF_2026Nov03-0839_managed_stage.json'),'utf8'),
  readFile(resolve(folder,'wtValveweights.json'),'utf8').then(JSON.parse),
]);
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const errors=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:920}});
  page.on('pageerror',error=>errors.push(String(error)));
  await page.goto((process.env.EMPIRICAL_BROWSER_BASE_URL||'http://127.0.0.1:4173')+
    '/tests/fixtures/empirical-weight-nearest-browser.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(async ({xml,stage,masterRows})=>{
    const doc=new DOMParser().parseFromString(xml,'application/xml');
    const ratingByBranch={};
    for(const branch of doc.getElementsByTagName('Branch')){
      const name=branch.getElementsByTagName('Branchname')[0]?.textContent||'';
      const cls=name.match(/-(\d{5})-\d{2}\/B\d+$/)?.[1];
      const rating=({'93833':900,'13451':150})[cls];
      if(!rating)throw Error('Unknown piping class in GLRD '+name);
      ratingByBranch[name]=rating;
    }
    const module=await import('/tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-phase6-unified-review.js?v=20261108-phase6-unified-r1');
    const card=document.createElement('section');
    card.id='phase6-glrd-actual';
    card.style.cssText='background:#0f172a;color:white;padding:18px;';
    document.body.appendChild(card);
    const config={weight:{masterRows},overrides:{rating:ratingByBranch}};
    window.__phase6Ref={current:{
      sourceKind:'xml',sourceText:xml,stagedJsonText:stage,
      sourceNameOverride:'GLRD-1000-PI-01 - BM2.xml',
      activePhaseId:'weight-match',supportConfigJson:JSON.stringify(config),
      masterContext:{weightMasterRows:masterRows,config},
      outputRunReadinessReport:{summary:{blockingCount:0}},
      result:{ok:true,ciiText:'ORIGINAL-NOT-REAL'},
    }};
    window.__phase6Render=()=>module.renderUnifiedPhase6WeightReview(
      card,window.__phase6Ref,window.__phase6Render);
    window.__phase6Render();
  },{xml,stage,masterRows});
  assert.match(await page.locator('#phase6-glrd-actual').innerText(),
    /Rigid Weights Need Review — Consolidated/);
  assert.equal(await page.locator('#mc-wm-content').count(),0,
    'Phase 6 must not render old Weight Match mass-edit table');
  await page.locator('[data-phase6-refresh-review]').click();
  assert.match(await page.locator('[data-phase6-status]').innerText(),/114 unresolved/i);
  assert.equal(await page.locator('[data-phase6-source-summary] tbody tr').count(),1);
  await page.locator('[data-phase6-open-review]').click();
  assert.equal(await page.locator('[data-mode-a-rigid-review-row]').count(),114);
  assert.equal(await page.locator('[data-rigid-suggestion-verified]').count(),0,
    'new Phase 6 retains explicit batch attestation, no per-row Reviewed controls');
  const blind=page.locator('[data-mode-a-rigid-review-row]').filter({hasText:'BLIND FLANGE 900#'}).first();
  assert.match(await blind.locator('[data-mode-a-rigid-candidate]').first().innerText(),
    /≈ 46\.343 kg · Blind Flange/);
  const initial=await page.evaluate(()=>window.__phase6Ref.current.supportConfigJson);
  await page.locator('[data-mode-a-rigid-cancel]').click();
  assert.equal(await page.evaluate(()=>window.__phase6Ref.current.supportConfigJson),initial,
    'cancel must not persist even a draft');
  await page.locator('[data-phase6-open-review]').click();
  await page.locator('[data-mode-a-rigid-apply-suggestions]').click();
  assert.equal(await page.locator('.mc-rigid-review-input[data-rigid-suggestion-draft="estimate"]').count(),109);
  assert.equal(await page.locator('[data-mode-a-rigid-show-missing]').innerText(),'Show missing (5)');
  await page.locator('[data-mode-a-rigid-skip-blanks]').click();
  await page.locator('[data-mode-a-rigid-apply]').click();
  assert.equal(await page.locator('[data-mode-a-rigid-bulk-review-table] tbody tr').count(),109);
  assert.equal(await page.locator('[data-mode-a-rigid-confirm-bulk-review]').isDisabled(),true);
  // Test-only simulated attestation: no engineering source mass authority
  // is being claimed for the empirical suggestions.
  await page.locator('[data-mode-a-rigid-bulk-attest]').check();
  await page.locator('[data-mode-a-rigid-confirm-bulk-review]').click();
  await page.locator('[data-mode-a-rigid-apply]').click();
  const record=await page.evaluate(()=>{
    const state=window.__phase6Ref.current;
    const cfg=JSON.parse(state.supportConfigJson);
    return {
      positives:Object.keys(cfg.overrides.rigidWeight||{}).length,
      receipts:Object.keys(cfg.overrides.rigidWeightReviewReceipts||{}).length,
      skips:Object.keys(cfg.overrides.rigidWeightSkipped||{}).length,
      zeroMassInPositives:Object.values(cfg.overrides.rigidWeight||{}).filter(v=>Number(v)===0).length,
      outputResult:state.result,
      readiness:state.outputRunReadinessReport,
    };
  });
  assert.deepEqual(record,{
    positives:109,receipts:109,skips:5,zeroMassInPositives:0,
    outputResult:null,readiness:null,
  });
  await page.locator('[data-phase6-refresh-review]').click();
  assert.match(await page.locator('[data-phase6-status]').innerText(),/0 unresolved/i,
    'Run/Phase 6 must honor prior five intentional skipped zero-mass records');
  // Re-extract from the NEW Phase 6 UI's actual committed config, not from
  // the old Weight Match controls, and compare its enriched XML byte-for-byte.
  const reextracted=await page.evaluate(async()=>{
    const state=window.__phase6Ref.current;
    const {enrichStandaloneXmlForRun}=await import(
      '/tabs/xml-cii-2019-standalone/xml-cii-standalone-run-parity.js');
    const result=await enrichStandaloneXmlForRun({
      sourceText:state.sourceText,stagedJsonText:state.stagedJsonText,
      supportConfigJson:state.supportConfigJson,options:{},
    });
    if(!result.applied || !result.xmlText)throw new Error(
      'Phase 6 XML extraction failed: '+(result.error||'no emitted XML'));
    return {xmlText:result.xmlText,mismatches:result.evidence?.mismatches?.length||0,
      comparisons:result.evidence?.comparisons||0};
  });
  const control=await readFile(resolve(out,'baseline-simulated-reviewed-enriched.xml'),'utf8');
  const actual=resolve(out,'phase6-ui-reextracted-enriched.xml');
  await writeFile(actual,reextracted.xmlText);
  assert.equal(reextracted.mismatches,0,'Phase 6 enriched run-parity mismatches');
  assert.equal(reextracted.xmlText.length,control.length,'Phase 6 XML byte length differs');
  assert.equal(reextracted.xmlText,control,
    'Phase 6 actually committed UI config must re-extract byte-identical GLRD enriched XML');
  await page.screenshot({path:resolve(out,'phase6-consolidated-glrd-after-review.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  await writeFile(resolve(out,'phase6-browser-ui-receipt.json'),JSON.stringify({
    schema:'glrd-phase6-ui-r1',source:'pinned-owner-GLRD-BM2',
    beforeUnresolved:114,reviewDrafts:109,explicitZeroSkips:5,
    afterUnresolved:0,approvalMode:'SIMULATED_EXPLICIT_ATTESTATION',
    approvedByMasterOnly:false,record,
    browserErrors:errors,
    reextraction:{bytes:reextracted.xmlText.length,
      comparisons:reextracted.comparisons,mismatches:reextracted.mismatches,
      baselineByteParity:'EQUAL'},
  },null,2));
  console.log('GLRD_PHASE6_ACTUAL_UI_PASS',JSON.stringify(record));
}finally{await browser.close();}
