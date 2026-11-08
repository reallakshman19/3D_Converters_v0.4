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
    const module=await import('/tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-phase6-unified-review.js?v=20261108-phase6-error40-r3');
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
  assert.equal(await page.locator('[data-phase6-ledger-row]').count(),114,
    'Phase 6 keeps a source-keyed read-only mass audit ledger');
  await page.locator('[data-phase6-open-review]').click();
  assert.equal(await page.locator('[data-mode-a-rigid-review-row]').count(),114);
  assert.equal(await page.locator('[data-rigid-suggestion-verified]').count(),0,
    'new Phase 6 retains explicit batch attestation, no per-row Reviewed controls');
  const blind=page.locator('[data-mode-a-rigid-review-row]').filter({hasText:'BLIND FLANGE 900#'}).first();
  assert.match(await blind.locator('[data-mode-a-rigid-candidate]').first().innerText(),
    /≈ 46\.343 kg · Blind Flange/);
  const initial=await page.evaluate(()=>window.__phase6Ref.current.supportConfigJson);
  assert.equal(await page.locator('[data-phase6-approve-all]').count(),1);
  assert.equal(await page.locator('[data-phase6-deviation40]').count(),1);
  assert.match(await page.locator('.mc-rigid-review-dialog thead').innerText(),/Reference \(kg\)/);
  assert.match(await page.locator('.mc-rigid-review-dialog thead').innerText(),/Error %/);
  // Exercise real DTXR -> Preview toggle, recompute candidates and ensure no
  // Rating was saved without the explicit Save button.
  const dtxrRow=page.locator('[data-mode-a-rigid-review-row]')
    .filter({hasText:'900#'}).first();
  const dtxrInput=dtxrRow.locator('.mc-rigid-review-rating-input');
  const previewRating=await dtxrInput.inputValue();
  await page.locator('[data-phase6-dtxr]').click();
  await page.waitForFunction(()=>document.querySelector('[data-mode-a-rigid-status]')
    ?.textContent?.includes('Suggestions refreshed'));
  assert.equal(await page.locator('[data-phase6-dtxr]').innerText(),'Use Rating shown in Preview');
  assert.equal(await dtxrInput.inputValue(),'900');
  await page.locator('[data-phase6-dtxr]').click();
  await page.waitForFunction(()=>document.querySelector('[data-mode-a-rigid-status]')
    ?.textContent?.includes('Suggestions refreshed'));
  assert.equal(await page.locator('[data-phase6-dtxr]').innerText(),'Use Rating as per DTXR');
  assert.equal(await dtxrInput.inputValue(),previewRating);
  assert.equal(await page.evaluate(()=>window.__phase6Ref.current.supportConfigJson),initial,
    'DTXR/Preview toggle alone cannot write any Rating or physical mass');
  await page.locator('[data-mode-a-rigid-cancel]').click();
  assert.equal(await page.evaluate(()=>window.__phase6Ref.current.supportConfigJson),initial,
    'cancel must not persist even a draft');
  // Phase 6 must allow partial manual mass saves while 113 other physical
  // components remain unresolved, without accidentally starting conversion.
  await page.locator('[data-phase6-open-review]').click();
  await page.locator('.mc-rigid-review-input').first().fill('59');
  await page.locator('[data-mode-a-rigid-apply]').click();
  const partial=await page.evaluate(()=>{
    const cfg=JSON.parse(window.__phase6Ref.current.supportConfigJson);
    return {positive:Object.keys(cfg.overrides.rigidWeight||{}).length,
      output:window.__phase6Ref.current.result};
  });
  assert.deepEqual(partial,{positive:1,output:null},
    'a single manual mass may save independently without running CII or fabricating other weights');
  await page.locator('[data-phase6-undo]').click();
  assert.equal(await page.evaluate(()=>window.__phase6Ref.current.supportConfigJson),initial,
    'undo must revert the partial manual edit exactly');
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
  assert.equal(await page.locator('[data-phase6-ledger-row]').count(),114,
    '109 accepted masses and five editable skip decisions remain inspectable');
  await page.locator('[data-phase6-ledger]').evaluate(el=>el.open=true);
  await page.locator('[data-phase6-ledger-filter]').selectOption('skipped');
  assert.equal(await page.locator('[data-phase6-ledger-row]:visible').count(),5);
  await page.locator('[data-phase6-ledger-filter]').selectOption('reviewed');
  assert.equal(await page.locator('[data-phase6-ledger-row]:visible').count(),109);
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
  // Regression previously missed by XML parity: 109 already-mapped masses
  // must be present as editable source weights, without auto-copying an old
  // approval receipt to a changed value.
  const originalCommittedConfig=await page.evaluate(()=>window.__phase6Ref.current.supportConfigJson);
  await writeFile(resolve(out,'phase6-ui-reviewed-config.json'),originalCommittedConfig);
  await page.locator('[data-phase6-open-review]').click();
  assert.equal(await page.locator('[data-phase6-row-details]').count(),114,
    'every source component must expose the full evidence without horizontal scrolling');
  await page.locator('[data-phase6-row-details]').first().evaluate(el=>el.open=true);
  assert.match(await page.locator('[data-phase6-row-details]').first().innerText(),/Weight Source/);
  await page.screenshot({path:resolve(out,'phase6-full-weight-workbench-editable.png'),fullPage:true});
  const mappedInputs=page.locator('.mc-rigid-review-input[data-original-weight]:not([data-original-weight=""])');
  assert.equal(await mappedInputs.count(),109,'all 109 mapped masses must be editable');
  for(const title of ['Line Key','Component Type','Valve Hint','Current Weight','Status','Score','Candidate Type']){
    assert.ok((await page.locator('.mc-rigid-review-dialog thead').innerText()).includes(title),
      'full Phase 6 column missing: '+title);
  }
  assert.equal(await page.locator('[data-phase6-nearest]').count(),1);
  assert.equal(await page.locator('[data-phase6-find-exact]').count(),1);
  assert.equal(await page.locator('[data-phase6-fill-similar]').count(),1);
  const target=mappedInputs.first();
  const originalMass=Number(await target.inputValue());
  await page.locator('[data-phase6-nearest]').click();
  assert.equal(Number(await target.inputValue()),originalMass,
    'nearest fill must never overwrite an approved or manually saved mass');
  await page.locator('[data-phase6-fill-similar]').click();
  assert.equal(Number(await target.inputValue()),originalMass,
    'group exact fill must never overwrite a saved mass');
  await page.locator('[data-phase6-find-exact]').click();
  assert.equal(await page.locator('[data-phase6-find-exact]').innerText(),'Show All Weights');
  await page.locator('[data-phase6-find-exact]').click();
  assert.equal(await page.locator('[data-mode-a-rigid-review-row]:visible').count(),114);
  assert.equal(await page.locator('[data-phase6-popup-counters]').count(),1);
  assert.match(await page.locator('[data-phase6-popup-counters]').innerText(),/109 existing masses/);
  const key=await target.getAttribute('data-issue-key');
  const changedMass=originalMass+2;
  await target.fill(String(changedMass));
  await page.locator('[data-mode-a-rigid-apply]').click();
  const changed=await page.evaluate(key=>{
    const cfg=JSON.parse(window.__phase6Ref.current.supportConfigJson);
    return {mass:cfg.overrides.rigidWeight[key],
      receipt:cfg.overrides.rigidWeightReviewReceipts?.[key]||null,
      skipped:cfg.overrides.rigidWeightSkipped?.[key]||null};
  },key);
  assert.equal(changed.mass,changedMass,'edited mapped weight saved to original key');
  await writeFile(resolve(out,'phase6-ui-edited-mass-config.json'),
    await page.evaluate(()=>window.__phase6Ref.current.supportConfigJson));
  assert.equal(changed.receipt,null,'old reviewed mass cannot authorize a different value');
  assert.equal(changed.skipped,null,'edited mapped weight cannot be a zero skip');
  const editedXml=await page.evaluate(async()=>{
    const state=window.__phase6Ref.current;
    const {enrichStandaloneXmlForRun}=await import(
      '/tabs/xml-cii-2019-standalone/xml-cii-standalone-run-parity.js');
    const result=await enrichStandaloneXmlForRun({
      sourceText:state.sourceText,stagedJsonText:state.stagedJsonText,
      supportConfigJson:state.supportConfigJson,options:{},
    });
    if(!result.applied||!result.xmlText)throw Error('Edited Phase 6 XML failed to extract');
    return result.xmlText;
  });
  assert.notEqual(editedXml,control,'changing mapped mass must change enriched XML');
  const engineeringDiff=await page.evaluate(({before,after})=>{
    function nodes(xml){
      const doc=new DOMParser().parseFromString(xml,'application/xml');
      const all=[];
      for(const branch of doc.getElementsByTagName('Branch')){
        const name=branch.getElementsByTagName('Branchname')[0]?.textContent||'';
        const rows=[...branch.getElementsByTagName('Node')];
        rows.forEach((node,i)=>{
          const clone=node.cloneNode(true);
          [...clone.getElementsByTagName('Weight')].forEach(x=>x.remove());
          const weight=node.getElementsByTagName('Weight')[0]?.textContent||'';
          all.push({id:name+'::'+i,body:new XMLSerializer().serializeToString(clone),weight});
        });
      }
      return all;
    }
    const left=nodes(before),right=nodes(after);
    if(left.length!==right.length)return {nodeCountEqual:false};
    const structural=left.filter((node,i)=>node.body!==right[i].body).length;
    const masses=left.filter((node,i)=>node.weight!==right[i].weight)
      .map((node,i)=>node.id);
    return {nodeCountEqual:true,structural,changedMassCount:masses.length};
  },{before:control,after:editedXml});
  assert.deepEqual(engineeringDiff,{nodeCountEqual:true,structural:0,changedMassCount:1},
    'the changed mass must alter exactly one enriched Node Weight without any structural change');
  await writeFile(resolve(out,'phase6-ui-edited-mass-enriched.xml'),editedXml);
  await page.locator('[data-phase6-undo]').click();
  const restored=await page.evaluate(()=>window.__phase6Ref.current.supportConfigJson);
  assert.equal(restored,originalCommittedConfig,
    'Undo must restore the full original source override, approval and skip custody');
  await writeFile(resolve(out,'phase6-mapped-edit-undo-receipt.json'),JSON.stringify({
    key,originalMass,changedMass,engineeringDiff,
    sourceIsolation:'source-keyed',approvalReused:false,
    undoRestoredExactConfig:true,
  },null,2));
  // Exercise a verified same-DN/Class catalog reference with a deliberately
  // incorrect mapped mass. The ±40% tool MUST NOT auto-approve/commit it.
  await page.locator('[data-phase6-open-review]').click();
  const candidate=page.locator('[data-mode-a-rigid-review-row]')
    .filter({has:page.locator('[data-phase6-reference-kg]:not([data-phase6-reference-kg=""])')})
    .filter({has:page.locator('.mc-rigid-review-input[data-original-weight]:not([data-original-weight=""])')})
    .first();
  assert.equal(await candidate.count(),1,'GLRD must have a length-qualified matching reference');
  const compKey=await candidate.locator('.mc-rigid-review-input').getAttribute('data-issue-key');
  const refKg=Number(await candidate.locator('[data-phase6-reference-kg]').getAttribute('data-phase6-reference-kg'));
  assert.ok(refKg>0);
  await candidate.locator('.mc-rigid-review-input').fill(String(refKg*2));
  await page.locator('[data-mode-a-rigid-apply]').click();
  await page.locator('[data-phase6-open-review]').click();
  const changedRow=page.locator('[data-mode-a-rigid-review-row]')
    .filter({has:page.locator('[data-issue-key="'+compKey.replace(/"/g,'')+'"]')}).first();
  const changedInput=page.locator('.mc-rigid-review-input[data-issue-key="'+compKey.replace(/"/g,'')+'"]');
  assert.equal(Number(await changedInput.inputValue()),refKg*2);
  assert.match(await changedInput.locator('xpath=..').locator('xpath=..')
    .locator('[data-phase6-error-pct]').innerText(),/\+100\.0%/);
  assert.match(await page.locator('[data-phase6-deviation40]').innerText(),/\([1-9]/);
  await page.locator('[data-phase6-deviation40]').click();
  assert.equal(Number(await changedInput.inputValue()),refKg);
  assert.equal(await changedInput.getAttribute('data-rigid-suggestion-draft'),'estimate');
  assert.equal(await changedInput.getAttribute('data-rigid-review-method'),null);
  // Saving an unapproved drafted correction must be refused.
  const pendingConfig=await page.evaluate(()=>window.__phase6Ref.current.supportConfigJson);
  await page.locator('[data-mode-a-rigid-apply]').click();
  assert.equal(await page.evaluate(()=>window.__phase6Ref.current.supportConfigJson),
    pendingConfig,'threshold button must not commit without explicit review');
  await page.locator('[data-phase6-approve-all]').click();
  assert.equal(await page.locator('[data-mode-a-rigid-bulk-review-panel]').isVisible(),true);
  assert.equal(await page.locator('[data-mode-a-rigid-confirm-bulk-review]').isDisabled(),true);
  await page.locator('[data-mode-a-rigid-bulk-attest]').check();
  await page.locator('[data-mode-a-rigid-confirm-bulk-review]').click();
  await page.locator('[data-mode-a-rigid-apply]').click();
  const accepted=await page.evaluate(key=>{
    const c=JSON.parse(window.__phase6Ref.current.supportConfigJson);
    return {kg:Number(c.overrides.rigidWeight[key]),
      reviewed:c.overrides.rigidWeightReviewReceipts?.[key]?.reviewed===true};
  },compKey);
  assert.deepEqual(accepted,{kg:refKg,reviewed:true});
  await page.locator('[data-phase6-undo]').click();
  const undoneComparison=await page.evaluate(key=>
    Number(JSON.parse(window.__phase6Ref.current.supportConfigJson).overrides.rigidWeight[key]),compKey);
  assert.equal(undoneComparison,refKg*2,'Undo restores the prior mass, not the reference');
  await writeFile(resolve(out,'phase6-deviation40-review-receipt.json'),JSON.stringify({
    sourceKey:compKey,referenceKg:refKg,existingMassKg:refKg*2,
    signedErrorPct:100,thresholdPercent:40,
    stagedOnly:true,noAutoApproval:true,
    reviewedViaExplicitAttestation:true,undoRestoresExistingMass:true,
  },null,2));
  // Restore the approved GLRD simulated review fixture after the separate
  // deliberate-error experiment. This is NOT a production mass edit.
  await page.evaluate(config=>{
    window.__phase6Ref.current={
      ...window.__phase6Ref.current, supportConfigJson:config,
      phase6Undo:null,result:null,outputRunReadinessReport:null
    };
    window.__phase6Render();
  },originalCommittedConfig);

  console.log('GLRD_PHASE6_ACTUAL_UI_PASS',JSON.stringify(record));
}finally{await browser.close();}
