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
   const {collectModeARigidWeightReviewIssues,openModeAConsolidatedRigidWeightReviewPopup}=
     await import('/tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a.js?v=20261107-choice-skip-trace-1');
   const {availableWeightReviewChoices}=
     await import('/converters/xml-cii2019-core/weight-review-choices.js?v=20261107-choice-skip-trace-1');
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
     choices:availableWeightReviewChoices(issue)
   })).filter(x=>x.choices.length>1);
   window.__glrdReviewPromise=openModeAConsolidatedRigidWeightReviewPopup([
     {sourceId:'GLRD-BM2',fileName:'GLRD-1000-PI-01 - BM2.xml',state,config,issues}
   ]);
   return {count:issues.length,alternatives:alternatives.map(({ref,node,choices})=>
     ({ref,node,count:choices.length,weights:choices.map(x=>x.weight),
       lengths:choices.map(x=>x.referenceLengthMm)}))};
 },{xml,stage,masterRows});
 assert.equal(census.count,114);
 assert.equal(await page.locator('[data-mode-a-rigid-review-row]').count(),114);
 assert.equal(await page.locator('.mc-rigid-review-input[data-rigid-suggestion-draft]').count(),0,
   'opening popup never commits an empirical mass');
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
 assert.match(await page.locator('[data-mode-a-rigid-status]').innerText(),/review 109/i);
 if((await page.locator('[data-mode-a-rigid-show-missing]').innerText()).startsWith('Show all'))
   await page.locator('[data-mode-a-rigid-show-missing]').click();
 const alternativeSelectors=await page.locator('[data-mode-a-rigid-choice]').count();
 if(alternativeSelectors){
   const choice=page.locator('[data-mode-a-rigid-choice]').first();
   const options=await choice.locator('option').allTextContents();
   assert.ok(options.length>2,'must offer multiple reference lengths/weights');
   assert.ok(options.some(x=>x.includes('master L=')),'must disclose reference length');
   // An alternate master is a proposal only; choosing it must NOT auto-check Reviewed.
   await choice.selectOption({index:2});
   const tr=choice.locator('xpath=ancestor::tr');
   assert.equal(await tr.locator('[data-rigid-suggestion-verified]').isChecked(),false);
   assert.equal(await tr.locator('.mc-rigid-review-input').getAttribute('data-rigid-suggestion-draft'),'estimate');
 }
 // Acceptance simulation ONLY: test deliberate review of all 109 proposals,
 // never declare an actual Owner approval from the tool's click.
 await page.evaluate(()=>document.querySelectorAll('.mc-rigid-review-input[data-rigid-suggestion-draft="estimate"]')
   .forEach(input=>{
     const box=input.closest('tr')?.querySelector('[data-rigid-suggestion-verified]');
     if(box)box.checked=true;
   }));
 await page.locator('[data-mode-a-rigid-apply]').click();
 const outcome=await page.evaluate(async()=>await window.__glrdReviewPromise);
 assert.equal(outcome.cancelled,false);
 const updates=outcome.updates?.['GLRD-BM2'];
 assert.ok(updates);
 assert.equal(Object.keys(updates.weightsByKey||{}).length,111,'109 estimates and two deliberate manual inputs');
 assert.equal(Object.keys(updates.skippedByKey||{}).length,3,'three intentionally skipped source refs');
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
     zeroMassInOverrides:Object.values(cfg.overrides.rigidWeight||{}).filter(x=>Number(x)===0).length};
 },updates);
 assert.deepEqual(verifiedState,{massCount:111,skipCount:3,zeroMassInOverrides:0});
 assert.deepEqual(errors,[]);
 const receipt={schema:'GLRD-CHOICE-SKIP-TRACE-UI-R1',
   glrdRows:census.count,draftPrefills:drafts,
   initialMissing:missingStart,afterManualMissing:3,afterSkipMissing:0,
   multipleChoiceRows:census.alternatives.length,examples:census.alternatives.slice(0,10),
   renderedAlternativeSelectors:alternativeSelectors,
   reviewGateBeforeCheckbox:'BLOCKED',simulatedReviewedMasses:111,
   explicitZeroSkips:3,verifiedState,
   engineeringMassApproval:'NO_AUTOMATIC_APPROVAL_FROM_ESTIMATE',errors};
 await writeFile(resolve(output,'glrd-choice-skip-trace-receipt.json'),JSON.stringify(receipt,null,2));
 console.log('GLRD_CHOICE_SKIP_TRACE_PASS',JSON.stringify({
   rows:114,drafts,initialMissing:missingStart.length,afterManualMissing:3,afterSkipMissing:0,
   alternatives:census.alternatives.length,renderedAlternativeSelectors,
   zeroOverrides:verifiedState.zeroMassInOverrides}));
} finally {await browser.close()}
