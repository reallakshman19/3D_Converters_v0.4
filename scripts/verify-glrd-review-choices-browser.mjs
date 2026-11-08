// Owner GLRD source-to-visible review UI: 5 missing -> 3 -> 0 skipped,
// source-key trace, alternative length choices, and no silent source mass.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const folder=process.env.GLRD_INPUT_DIR||'/tmp/glrd-inputs';
const output=resolve('artifacts/glrd-review-choices');
await mkdir(output,{recursive:true});
const xml=await readFile(resolve(folder,'GLRD-1000-PI-01 - BM2.xml'),'utf8');
const stage=await readFile(resolve(folder,'STF_2026Nov03-0839_managed_stage.json'),'utf8');
const masterRows=JSON.parse(await readFile(resolve(folder,'wtValveweights.json'),'utf8'));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const errors=[];
try {
 const page=await browser.newPage({viewport:{width:1440,height:860}});
 page.on('pageerror',e=>errors.push(String(e)));
 await page.goto((process.env.EMPIRICAL_BROWSER_BASE_URL||'http://127.0.0.1:4173')+
   '/tests/fixtures/empirical-weight-nearest-browser.html',{waitUntil:'domcontentloaded'});
 const census=await page.evaluate(async ({xml,stage,masterRows})=>{
   const {collectModeARigidWeightReviewIssues,openModeAConsolidatedRigidWeightReviewPopup,
     modeARigidSelectableSuggestions}=
     await import('/tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a.js?v=20261107-weights-pyodide-fix-1');
   const d=new DOMParser().parseFromString(xml,'application/xml');
   const ratingByBranch={};
   for(const branch of d.getElementsByTagName('Branch')){
     const name=branch.getElementsByTagName('Branchname')[0]?.textContent||'';
     const cls=name.match(/-(\d{5})-\d{2}\/B\d+$/)?.[1];
     const rating=({'93833':900,'13451':150})[cls];
     if(!rating)throw Error('Unknown piping-class Rating '+name);
     ratingByBranch[name]=rating;
   }
   const config={weight:{masterRows},overrides:{rating:ratingByBranch}};
   const state={sourceText:xml,stagedJsonText:stage};
   const issues=await collectModeARigidWeightReviewIssues(state,config);
   const alternatives=issues.map(issue=>({
     ref:issue.componentRefNo,node:issue.nodeNumberDisplay||issue.nodeNumber,
     choices:modeARigidSelectableSuggestions(issue)
   })).filter(x=>x.choices.length>1);
   window.__glrdReviewEntries=[
     {sourceId:'GLRD-BM2',fileName:'GLRD-1000-PI-01 - BM2.xml',state,config,issues}
   ];
   window.__glrdReviewPromise=openModeAConsolidatedRigidWeightReviewPopup(window.__glrdReviewEntries);
   return {count:issues.length,alternatives:alternatives.map(({ref,node,choices})=>
     ({ref,node,count:choices.length,weights:choices.map(x=>x.weight),
       lengths:choices.map(x=>x.referenceLengthMm)}))};
 },{xml,stage,masterRows});
 assert.equal(census.count,114);
 assert.equal(await page.locator('[data-mode-a-rigid-review-row]').count(),114);
 assert.equal(await page.locator('.mc-rigid-review-input[data-rigid-suggestion-draft]').count(),0,
   'opening popup never commits an empirical mass');
 // The five real DN80 Class900 Blind Flange extrapolations must be single
 // clickable "estimate only" buttons like the old UI, not passive chips.
 const blindRow=page.locator('[data-mode-a-rigid-review-row]')
   .filter({hasText:'BLIND FLANGE 900#'}).first();
 assert.equal(await blindRow.count(),1,'real GLRD missing Blind Flange row');
 const blindButton=blindRow.locator('[data-mode-a-rigid-candidate]').first();
 assert.equal(await blindButton.count(),1,'estimate-only mass must be a clickable button');
 assert.match(await blindButton.innerText(),/≈ 46\.343 kg · Blind Flange · estimate only/i);
 assert.equal(await blindRow.locator('select[data-mode-a-rigid-choice]').count(),0);
 assert.equal(await blindRow.locator('[data-mode-a-rigid-propose]').count(),0);
 await blindButton.click();
 assert.equal(await blindRow.locator('.mc-rigid-review-input').inputValue(),'46.343');
 assert.equal(await blindRow.locator('.mc-rigid-review-input').getAttribute('data-rigid-suggestion-draft'),'estimate',
   'click stages, never silently approves, 46.343 kg');
 assert.equal(await blindRow.locator('.mc-rigid-review-input').getAttribute('data-rigid-review-method'),null);
 await blindRow.locator('.mc-rigid-review-input').fill('');
 // Restore original Owner five missing rows before the 5→3→0 sequence.
 assert.equal(await page.locator('[data-mode-a-rigid-show-missing]').innerText(),'Show missing (114)');
 assert.equal(await page.locator('[data-mode-a-rigid-show-missing]').innerText(),'Show missing (114)');
 await page.locator('[data-mode-a-rigid-apply-suggestions]').click();
 const drafts=await page.locator('.mc-rigid-review-input[data-rigid-suggestion-draft="estimate"]').count();
 const missingStart=await page.locator('.mc-rigid-review-input').evaluateAll(xs=>xs
   .filter(x=>x.value==='').map(x=>({
     key:x.dataset.issueKey,
     source:x.dataset.sourceId,
     node:x.closest('tr')?.children[4]?.textContent?.trim(),
     ref:x.closest('tr')?.querySelector('[data-rigid-review-source-ref]')?.textContent?.trim(),
     dtxr:x.closest('tr')?.children[5]?.textContent?.trim()
   })));
 assert.equal(drafts,109,'109 eligible draft prefills from original GLRD');
 assert.equal(missingStart.length,5,'5 exact Owner missing blind-flange rows');
 assert.equal(await page.locator('[data-mode-a-rigid-show-missing]').innerText(),'Show missing (5)');
 const detailedList=await page.locator('[data-mode-a-rigid-missing-list]').innerText();
 for(const entry of missingStart) {
   assert.ok(entry.key && entry.ref && entry.source && entry.dtxr,
     'every missing row needs exact source/ref/DTXR: '+JSON.stringify(entry));
   assert.ok(detailedList.includes(entry.ref.replace(/_\d+$/,'')),
     'missing list includes source reference '+entry.ref);
 }
 await page.locator('[data-mode-a-rigid-show-missing]').click();
 assert.equal(await page.locator('[data-mode-a-rigid-review-row]:visible').count(),5);
 const blanks=page.locator('.mc-rigid-review-input');
 const emptyIndices=await blanks.evaluateAll(xs=>xs.flatMap((x,i)=>x.value===''?[i]:[]));
 assert.equal(emptyIndices.length,5);
 for(const [i,index] of emptyIndices.slice(0,2).entries()){
   await blanks.nth(index).fill(String(i===0?5:7)); // deliberate manual test values
 }
 assert.equal(await page.locator('[data-mode-a-rigid-show-missing]').innerText(),'Show all (3)',
   'manual entry changes missing census from 5 to 3');
 const remaining=await blanks.evaluateAll(xs=>xs.filter(x=>x.value==='').length);
 assert.equal(remaining,3);
 await page.screenshot({path:resolve(output,'glrd-three-missing-traced.png')});
 await page.locator('[data-mode-a-rigid-skip-blanks]').click();
 assert.equal(await page.locator('.mc-rigid-review-input[data-rigid-skipped-zero="true"]').count(),3);
 assert.equal(await page.locator('[data-mode-a-rigid-show-missing]').innerText(),'Show missing (0)',
   'zero missing automatically exits missing-only mode and restores all visible rows');
 await page.locator('[data-mode-a-rigid-apply]').click();
 assert.equal(await page.locator('[data-mode-a-rigid-review-row]').count(),114,
   'unreviewed 109 estimates must refuse publication even after zero skip');
 assert.match(await page.locator('[data-mode-a-rigid-status]').innerText(),/109 estimate draft/i);
 assert.equal(await page.locator('[data-mode-a-rigid-bulk-review-panel]').isVisible(),true,
   'blocked Apply must open actionable confirmation panel, not a red dead end');
 assert.match(await page.locator('[data-mode-a-rigid-bulk-review-summary]').innerText(),/109 unapproved/);
 assert.equal(await page.locator('[data-mode-a-rigid-confirm-bulk-review]').isDisabled(),true,
   'no bulk approval until reviewer explicitly attests independent verification');
 assert.equal(await page.locator('[data-mode-a-rigid-show-unreviewed]').innerText(),'Show all (109)');
 await page.screenshot({path:resolve(output,'glrd-blocked-apply-explicit-review-step.png')});
 if((await page.locator('[data-mode-a-rigid-show-missing]').innerText()).startsWith('Show all'))
   await page.locator('[data-mode-a-rigid-show-missing]').click();
 const alternativeRows=await page.evaluate(()=>[...document.querySelectorAll('[data-mode-a-rigid-review-row]')]
   .filter(tr=>tr.querySelectorAll('[data-mode-a-rigid-candidate]').length>1).length);
 const alternativeButtons=await page.locator('[data-mode-a-rigid-candidate]').count();
 assert.ok(alternativeButtons>=109,'all positive catalog or extrapolated values must be clickable');
 assert.equal(await page.locator('select[data-mode-a-rigid-choice],[data-mode-a-rigid-propose]').count(),0,
   'no dropdowns, no Use draft, no non-clickable advisory chips');
 if(alternativeRows){
   const multiple=page.locator('[data-mode-a-rigid-review-row]')
     .filter({has:page.locator('[data-mode-a-rigid-candidate][data-mode-a-rigid-option="1"]')}).first();
   const second=multiple.locator('[data-mode-a-rigid-candidate][data-mode-a-rigid-option="1"]');
   const weight=await second.getAttribute('data-mode-a-rigid-weight');
   await second.click();
   assert.equal(await multiple.locator('.mc-rigid-review-input').inputValue(),weight);
   assert.equal(await multiple.locator('.mc-rigid-review-input').getAttribute('data-rigid-review-method'),null);
   assert.equal(await multiple.locator('.mc-rigid-review-input').getAttribute('data-rigid-suggestion-draft'),'estimate');
 }
 // Acceptance simulation ONLY: a reviewer would have to verify the physical
 // masses independently before giving this exact, non-default attestation.
 // Changing a proposal closes the old panel and invalidates a prior review.
 assert.equal(await page.locator('[data-mode-a-rigid-bulk-review-panel]').isVisible(),false);
 await page.locator('[data-mode-a-rigid-open-review]').click();
 assert.equal(await page.locator('[data-mode-a-rigid-confirm-bulk-review]').isDisabled(),true);
 await page.locator('[data-mode-a-rigid-bulk-attest]').check();
 assert.equal(await page.locator('[data-mode-a-rigid-confirm-bulk-review]').isEnabled(),true);
 await page.locator('[data-mode-a-rigid-confirm-bulk-review]').click();
 assert.equal(await page.locator('[data-mode-a-rigid-show-unreviewed]').innerText(),
   'Show pending reviews (0)','single explicit attestation closes 109 individual approval gates');
 assert.equal(await page.locator('.mc-rigid-review-input[data-rigid-review-method="EXPLICIT_BULK_OWNER_ATTESTATION"]').count(),109);
 await page.screenshot({path:resolve(output,'glrd-after-explicit-bulk-attestation.png')});
 await page.locator('[data-mode-a-rigid-apply]').click();
 const outcome=await page.evaluate(async()=>await window.__glrdReviewPromise);
 assert.equal(outcome.cancelled,false);
 const updates=outcome.updates?.['GLRD-BM2'];
 assert.ok(updates);
 assert.equal(Object.keys(updates.weightsByKey||{}).length,111,'109 estimates and two deliberate manual inputs');
 assert.equal(Object.keys(updates.skippedByKey||{}).length,3,'three intentionally skipped source refs');
 assert.equal(Object.keys(updates.reviewReceiptsByKey||{}).length,109,
   'each simulated bulk-accepted source mass has its own audit receipt');
 assert.ok(Object.values(updates.reviewReceiptsByKey).every(v=>
   v.reviewed===true && v.reviewMethod==='EXPLICIT_BULK_OWNER_ATTESTATION'));
 assert.ok(Object.values(updates.skippedByKey).every(x=>x.weightKg===0));
 assert.ok(Object.values(updates.weightsByKey).every(x=>x>0),'no fake 0 kg mass override');
 const verifiedState=await page.evaluate(async updates=>{
   const {applyModeAConsolidatedRigidReviewUpdates}=await import('/tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a-state.js');
   const state={sourceBatch:{activeSourceId:'GLRD-BM2',sources:[
     {sourceId:'GLRD-BM2',supportConfigJson:'{}'}]}};
   const applied=applyModeAConsolidatedRigidReviewUpdates(state,{'GLRD-BM2':updates});
   const cfg=JSON.parse(applied.sourceBatch.sources[0].supportConfigJson);
   return {massCount:Object.keys(cfg.overrides.rigidWeight||{}).length,
     skipCount:Object.keys(cfg.overrides.rigidWeightSkipped||{}).length,
     reviewReceiptCount:Object.keys(cfg.overrides.rigidWeightReviewReceipts||{}).length,
     zeroMassInOverrides:Object.values(cfg.overrides.rigidWeight||{}).filter(x=>Number(x)===0).length};
 },updates);
 assert.deepEqual(verifiedState,{massCount:111,skipCount:3,reviewReceiptCount:109,zeroMassInOverrides:0});

 // Exact reproduction of Owner's third screenshot: 109 estimated draft
 // weights, 5 zero skips, 0 missing, Apply blocked on 109 Reviewed flags.
 // Only an explicit independent review acknowledgment unlocks the modal.
 await page.evaluate(async()=>{
   const m=await import('/tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a.js?v=20261107-weights-pyodide-fix-1');
   window.__glrdFiveSkipPromise=m.openModeAConsolidatedRigidWeightReviewPopup(window.__glrdReviewEntries);
 });
 assert.equal(await page.locator('[data-mode-a-rigid-review-row]').count(),114);
 assert.equal(await page.locator('[data-rigid-suggestion-verified]').count(),0,
   'consolidated 114-row review must contain no per-row Reviewed controls');
 await page.locator('[data-mode-a-rigid-apply-suggestions]').click();
 assert.equal(await page.locator('.mc-rigid-review-input[data-rigid-suggestion-draft="estimate"]').count(),109);
 assert.equal(await page.locator('[data-mode-a-rigid-show-missing]').innerText(),'Show missing (5)');
 await page.locator('[data-mode-a-rigid-skip-blanks]').click();
 assert.equal(await page.locator('.mc-rigid-review-input[data-rigid-skipped-zero="true"]').count(),5);
 assert.equal(await page.locator('[data-mode-a-rigid-show-missing]').innerText(),'Show missing (0)');
 await page.locator('[data-mode-a-rigid-apply]').click();
 assert.equal(await page.locator('[data-mode-a-rigid-bulk-review-panel]').isVisible(),true);
 assert.equal(await page.locator('[data-mode-a-rigid-confirm-bulk-review]').isDisabled(),true);
 assert.match(await page.locator('[data-mode-a-rigid-status]').innerText(),/No blank weights remain/);
 assert.equal(await page.locator('[data-mode-a-rigid-review-row]').count(),114,
   'unreviewed masses must still block run without silently continuing');
 await page.screenshot({path:resolve(output,'glrd-109-unreviewed-five-skipped-real-screenshot-repro.png')});
 await page.locator('[data-mode-a-rigid-bulk-attest]').check();
 await page.locator('[data-mode-a-rigid-confirm-bulk-review]').click();
 assert.equal(await page.locator('[data-mode-a-rigid-show-unreviewed]').innerText(),'Show pending reviews (0)');
 await page.locator('[data-mode-a-rigid-apply]').click();
 const fiveOutcome=await page.evaluate(async()=>await window.__glrdFiveSkipPromise);
 assert.equal(fiveOutcome.cancelled,false);
 const fiveUpdates=fiveOutcome.updates?.['GLRD-BM2'];
 assert.ok(fiveUpdates);
 assert.equal(Object.keys(fiveUpdates.weightsByKey||{}).length,109);
 assert.equal(Object.keys(fiveUpdates.skippedByKey||{}).length,5);
 assert.equal(Object.keys(fiveUpdates.reviewReceiptsByKey||{}).length,109);
 assert.ok(Object.values(fiveUpdates.weightsByKey).every(v=>Number(v)>0));
 assert.equal(Object.values(fiveUpdates.weightsByKey).filter(v=>Number(v)===0).length,0);

 // Simulated explicit Owner review must also cross the exact standalone
 // run-parity handoff, not merely close a popup. Do not describe the browser
 // simulator's attestation as authentic engineering mass approval.
 const nativeHandoff=await page.evaluate(async ({xml,stage,fiveUpdates})=>{
   const {applyModeAConsolidatedRigidReviewUpdates}=
     await import('/tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a-state.js');
   const {enrichStandaloneXmlForRun}=
     await import('/tabs/xml-cii-2019-standalone/xml-cii-standalone-run-parity.js');
   const entry=window.__glrdReviewEntries[0];
   const state={sourceBatch:{activeSourceId:entry.sourceId,sources:[{
     sourceId:entry.sourceId,supportConfigJson:JSON.stringify(entry.config)
   }]}};
   const updated=applyModeAConsolidatedRigidReviewUpdates(state,{
     [entry.sourceId]:fiveUpdates
   });
   const supportConfigJson=updated.sourceBatch.sources[0].supportConfigJson;
   const result=await enrichStandaloneXmlForRun({
     sourceText:xml,stagedJsonText:stage,supportConfigJson,options:{}
   });
   // Produce an otherwise identical native-input baseline from the SAME
   // browser-enriched route with only the simulated source mass approvals
   // omitted. This avoids comparing to a different pipeline/configuration.
   const withoutMass=JSON.parse(supportConfigJson);
   delete withoutMass.overrides.rigidWeight;
   delete withoutMass.overrides.rigidWeightReviewReceipts;
   const baseline=await enrichStandaloneXmlForRun({
     sourceText:xml,stagedJsonText:stage,
     supportConfigJson:JSON.stringify(withoutMass),options:{}
   });
   return {applied:result.applied,error:result.error||'',
     comparisons:result.evidence?.comparisons??0,
     mismatches:result.evidence?.mismatches?.length??0,
     fields:result.appliedFields??0,
     xmlText:result.xmlText||'',supportConfigJson,
     baselineApplied:baseline.applied,baselineError:baseline.error||'',
     baselineXmlText:baseline.xmlText||''};
 },{xml,stage,fiveUpdates});
 assert.equal(nativeHandoff.applied,true,'simulated reviewed weights must be accepted by run parity: '+nativeHandoff.error);
 assert.ok(nativeHandoff.xmlText.length>0,'actual enriched XML must reach native handoff');
 assert.equal(nativeHandoff.mismatches,0,'browser run parity must not mismatch accepted source weights');
 assert.equal(nativeHandoff.baselineApplied,true,'same-route unedited XML baseline must apply: '+nativeHandoff.baselineError);
 assert.ok(nativeHandoff.baselineXmlText.length>0,'baseline engine XML must be emitted');
 await writeFile(resolve(output,'glrd-109-reviewed-five-skipped-baseline-engine-input.xml'),nativeHandoff.baselineXmlText);
 await writeFile(resolve(output,'glrd-109-reviewed-five-skipped-engine-input.xml'),nativeHandoff.xmlText);
 await writeFile(resolve(output,'glrd-109-reviewed-five-skipped-config.json'),nativeHandoff.supportConfigJson);
 console.log('GLRD_BULK_REVIEW_PARITY_HANDOFF_PASS',JSON.stringify({
   comparisons:nativeHandoff.comparisons,fields:nativeHandoff.fields,
   xmlBytes:nativeHandoff.xmlText.length,accepted:109,skipped:5,mismatches:0
 }));

 assert.deepEqual(errors,[]);
 const receipt={schema:'GLRD-CHOICE-SKIP-TRACE-UI-R1',
   glrdRows:census.count,draftPrefills:drafts,
   initialMissing:missingStart,afterManualMissing:3,afterSkipMissing:0,
   multipleChoiceRows:census.alternatives.length,examples:census.alternatives.slice(0,10),
   alternativeButtons:alternativeButtons,
   reviewGateBeforeCheckbox:'BLOCKED',simulatedReviewedMasses:111,
   explicitZeroSkips:3,verifiedState,
   ownerExactScreenshotRepro:{
     reviewedMassCount:Object.keys(fiveUpdates.weightsByKey).length,
     skippedZeroCount:Object.keys(fiveUpdates.skippedByKey).length,
     receiptCount:Object.keys(fiveUpdates.reviewReceiptsByKey).length,
     approvedZeroMassCount:0,
     completedAfterExplicitAttestation:true,
     runParityAccepted:nativeHandoff.applied,
     runParityComparisons:nativeHandoff.comparisons,
     runParityMismatches:nativeHandoff.mismatches
   },
   engineeringMassApproval:'NO_AUTOMATIC_APPROVAL_FROM_ESTIMATE',errors};
 await writeFile(resolve(output,'glrd-choice-skip-trace-receipt.json'),JSON.stringify(receipt,null,2));
 console.log('GLRD_CHOICE_SKIP_TRACE_PASS',JSON.stringify({
   rows:114,drafts,initialMissing:missingStart.length,afterManualMissing:3,afterSkipMissing:0,
   alternatives:census.alternatives.length,alternativeButtons,
   zeroOverrides:verifiedState.zeroMassInOverrides,
   screenshotFiveSkips:5,screenshotReviewed:109,screenshotCompleted:true}));
} finally {await browser.close()}
