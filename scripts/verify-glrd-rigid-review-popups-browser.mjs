// Owner GLRD source-derived review UI replay. This does not claim native
// Pyodide conversion/output parity; it exercises the real uploaded source
// identities, staged JSON, master rows and three live review popups.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const folder=process.env.GLRD_INPUT_DIR||'/tmp/glrd-inputs';
const base=process.env.EMPIRICAL_BROWSER_BASE_URL||'http://127.0.0.1:4173';
const out=resolve(process.env.EMPIRICAL_BROWSER_ARTIFACT_DIR||'artifacts/empirical-unknown-browser');
await mkdir(out,{recursive:true});
const files={
  xml:await readFile(resolve(folder,'GLRD-1000-PI-01 - BM2.xml')),
  stage:await readFile(resolve(folder,'STF_2026Nov03-0839_managed_stage.json')),
  master:await readFile(resolve(folder,'wtValveweights.json')),
};
const sha=x=>createHash('sha256').update(x).digest('hex');
assert.equal(sha(files.xml),'6bcc477860fdbe9a80159839bf476a8c1e6ce7a966587a25bc62498709843151','uploaded BM2 XML SHA');
assert.equal(sha(files.stage),'1d2469fe05d712cd1dd2da9913a840516ae686fb1616eb6d7b5e14d8918e2746','uploaded stage JSON SHA');
const masterRows=JSON.parse(files.master.toString('utf8'));
assert.ok(Array.isArray(masterRows) && masterRows.length===1595,'public master row count must match 1595 XLSX data rows');
const errors=[],receipt={schema:'GLRD-RIGID-POPUP-UI-R1',sourceSha256:sha(files.xml),
 stagedSha256:sha(files.stage),weightMasterJsonSha256:sha(files.master),
 limits:['No live Pyodide converter', 'No emitted CII parity', 'Review UI only', 'Master JSON counterpart to uploaded weight XLSX']};
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(base+'/tests/fixtures/empirical-weight-nearest-browser.html',{waitUntil:'domcontentloaded'});
 const facts=await page.evaluate(async ({xml,stage,masterRows})=>{
   const {collectModeARigidWeightReviewIssues}=await import('/tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a.js');
   const {collectXmlCiiZeroRigidWeightIssues}=await import('/converters/xml-cii2019-core/weight-match-model.js');
   const {isRigidWeightReviewEligibleIssue}=await import('/tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-prefill.js');
   const {rankXmlCiiWeightCandidates}=await import('/converters/xml-cii2019-core/weight-valve-hints.js');
   const {applyXmlCiiFlangeWeightFallbackToIssue}=await import('/converters/xml-cii2019-core/flange-weight-fallback.js');
   const {proposedRigidReviewWeight}=await import('/tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-prefill.js');
   const doc=new DOMParser().parseFromString(xml,'application/xml');
   const branches=doc.getElementsByTagName('Branch');
   const sourceNodes=doc.getElementsByTagName('Node');
   // From uploaded Piping class master.xlsx: 93833 -> 900 and 13451 -> 150.
   // This is a test fixture rating authority, not a production policy change.
   const classRating={'93833':900,'13451':150};
   const ratingByBranch={};
   for(const branch of branches){
     const branchName=branch.getElementsByTagName('Branchname')[0]?.textContent||'';
     const cl=branchName.match(/-(\d{5})-\d{2}\/B\d+$/)?.[1];
     if(!cl || !classRating[cl])throw Error('Missing uploaded master Rating for: '+branchName);
     ratingByBranch[branchName]=classRating[cl];
   }
   const config={weight:{masterRows},overrides:{rating:ratingByBranch}};
   const sourceState={sourceText:xml,stagedJsonText:stage};
   const rawIssues=collectXmlCiiZeroRigidWeightIssues(xml,stage,config);
   const issues=await collectModeARigidWeightReviewIssues(sourceState,config);
   window.__glrdAllIssues=issues;
   window.__glrdConfig=config;
   window.__glrdSourceState=sourceState;
   const selected=issues.find(x=>String(x.nodeNumber)==='60' && /\/B2$/.test(String(x.branchName)))
      || issues.find(x=>String(x.nodeNumber)==='60');
   if(!selected)throw Error('GLRD source endpoint node 60 not classified in collector');
   const known={...selected,rating:900,dtxr:'WELDING NECK FLANGE SCH 80S 900#',
     elementLengthSource:selected.elementLengthSource};
   const rank=rankXmlCiiWeightCandidates(known,config,{includeRejected:true});
   const corrected=applyXmlCiiFlangeWeightFallbackToIssue({
     ...known,candidates:rank.candidates.slice(0,5),ranking:rank,rejectedCandidates:rank.rejectedCandidates.slice(0,3)
   },config);
   const prop=proposedRigidReviewWeight(corrected);
   window.__glrdKnownIssue=corrected;
   return {branches:branches.length,nodes:sourceNodes.length,
      rawReviewIssues:rawIssues.length,
      excludedNonPhysical:rawIssues.filter(i=>!isRigidWeightReviewEligibleIssue(i)).length,
      reviewIssues:issues.length,
      sourceKey:selected.key,branch:selected.branchName,physicalLength:selected.lengthMm,
      lengthProvenance:selected.elementLengthSource,bore:selected.boreMm,rating:900,
      candidateKg:prop?.weight??null,candidateFamily:prop?.reference??null,approved:prop?.approved??null,
      typeCounts:issues.reduce((a,i)=>(a[i.componentType]=(a[i.componentType]||0)+1,a),{}),
      classRatings:classRating,
      qualifiedDrafts:issues.filter(i=>proposedRigidReviewWeight(i)).length,
      proposalByType:issues.reduce((m,i)=>{
        const type=i.reviewCategory||i.componentType||'OTHER';
        const key=type+':'+(proposedRigidReviewWeight(i)?'DRAFT':'NO_DRAFT');
        m[key]=(m[key]||0)+1;return m;
      },{}),
      noDraftReasons:issues.filter(i=>!proposedRigidReviewWeight(i)).reduce((m,i)=>{
        const reason=!i.rating?'NO_RATING'
          :(i.unknownComponentSuggestion&&!i.unknownComponentSuggestion.ok?'UNKNOWN_HOLD_'+i.unknownComponentSuggestion.code
            :i.elementLengthSource==='computed-forward'?'UNTRUSTED_ROUTE_LENGTH'
              :'NO_QUALIFIED_SAME_FAMILY_CANDIDATE');
        m[reason]=(m[reason]||0)+1;return m;
      },{})};
 },{xml:files.xml.toString('utf8'),stage:files.stage.toString('utf8'),masterRows});
 receipt.census=facts;
 assert.equal(facts.branches,31);
 assert.equal(facts.nodes,1196);
 assert.equal(facts.rawReviewIssues,154,'baseline unfiltered GLRD review census');
 assert.equal(facts.excludedNonPhysical,40,'OLET and unrelated connection rows excluded');
 assert.equal(facts.reviewIssues,114,'physical-source-only GLRD review queue');
 assert.ok(Math.abs(facts.physicalLength-147)<.01,'physical node 60 must span 147 mm');
 assert.ok(facts.candidateKg>0 && facts.approved===false,'actual master flange estimate must not auto-approve');
 // Full source queue from the actual collector: no mass writing when cancelled.
 await page.evaluate(async()=>{
   const m=await import('/tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a.js');
   window.__glrdFullPromise=m.openModeAConsolidatedRigidWeightReviewPopup([
     {sourceId:'BM2-SOURCE',fileName:'GLRD-1000-PI-01 - BM2.xml',
      state:window.__glrdSourceState,config:window.__glrdConfig,issues:window.__glrdAllIssues}
   ]);
 });
 assert.equal(await page.locator('[data-mode-a-rigid-review-row]').count(),facts.reviewIssues);
 await page.locator('[data-mode-a-rigid-apply-suggestions]').click();
 const fullPrefilled=await page.locator('.mc-rigid-review-input[data-rigid-suggestion-draft]').count();
 assert.ok(fullPrefilled>0,'uploaded GLRD must provide qualified drafts after class Rating restoration');
 assert.equal(fullPrefilled,facts.qualifiedDrafts,'bulk drafts must match pure source-proposal policy');
 await page.locator('[data-mode-a-rigid-apply]').click();
 assert.equal(await page.locator('[data-mode-a-rigid-review-row]').count(),facts.reviewIssues,
   'unreviewed full-queue Apply must not close or mutate the batch');
 assert.match(await page.locator('[data-mode-a-rigid-status]').innerText(),/missing|review/i);
 // Refresh must rerank the actual source queue, keep 154 identities and
 // discard unverified drafts rather than committing them.
 await page.locator('[data-mode-a-rigid-refresh]').click();
 await page.waitForFunction(()=>!document.querySelector('[data-mode-a-rigid-refresh]')?.disabled,null,{timeout:30000});
 assert.equal(await page.locator('[data-mode-a-rigid-review-row]').count(),facts.reviewIssues,'Refresh source review census parity');
 assert.equal(await page.locator('.mc-rigid-review-input[data-rigid-suggestion-draft="estimate"]').count(),0,
   'unreviewed prefill is not silently preserved as a manual value on rerank');
 await page.locator('[data-mode-a-rigid-apply-suggestions]').click();
 assert.equal(await page.locator('.mc-rigid-review-input[data-rigid-suggestion-draft]').count(),facts.qualifiedDrafts,
   'rebuilding full queue must preserve eligible draft count');
 await page.screenshot({path:resolve(out,'glrd-full-consolidated-draft.png')});
 await page.locator('[data-mode-a-rigid-cancel]').click();
 assert.equal((await page.evaluate(async()=>await window.__glrdFullPromise)).cancelled,true);
 receipt.fullQueue={rowCount:facts.reviewIssues,draftCount:fullPrefilled,cancel:'PASS'};
 // Source-derived real B2 endpoint (same 147mm/900 flange shown by Owner),
 // test single, ATTA and consolidated Modal UI without importing a fake mass.
 for(const route of ['single','atta','modeA']){
   await page.evaluate(async route=>{
     const issue=window.__glrdKnownIssue;
     if(route==='modeA'){
       const m=await import('/tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a.js');
       window.__glrdPromise=m.openModeAConsolidatedRigidWeightReviewPopup([
         {sourceId:'BM2-SOURCE',fileName:'GLRD-1000-PI-01 - BM2.xml',issues:[issue]}
       ]);
     }else{
       const file=route==='atta'?'xml-cii-adapted-run-workflow-atta-default.js':'xml-cii-adapted-run-workflow.js';
       const m=await import('/tabs/xml-cii-2019-standalone/ui-adapted/'+file);
       window.__glrdPromise=m.openStandaloneRigidWeightReviewPopup([issue],{current:{}},{});
     }
   },route);
   const mode=route==='modeA';
   const selector=mode?'[data-mode-a-rigid-apply-suggestions]':'[data-rigid-review-apply-suggestions]';
   assert.equal(await page.locator(selector).count(),1);
   const input=page.locator('.mc-rigid-review-input');
   assert.equal(await input.inputValue(),'','no automatic unapproved source-mass prefill');
   await page.locator(selector).click();
   assert.ok(Math.abs(Number(await input.inputValue())-facts.candidateKg)<.001,route+' draft weight');
   assert.equal(await input.getAttribute('data-rigid-suggestion-draft'),'estimate');
   const apply=page.locator(mode?'[data-mode-a-rigid-apply]':'[data-rigid-review-apply]');
   await apply.click();
   assert.match(await page.locator(mode?'[data-mode-a-rigid-status]':'[data-rigid-review-status]').innerText(),/review/i);
   assert.equal(await page.locator('.mc-rigid-review-input').count(),1,'unreviewed Apply must not close');
   await page.locator('[data-rigid-suggestion-verified]').check();
   await apply.click();
   const outcome=await page.evaluate(async()=>await window.__glrdPromise);
   const saved=mode?outcome.updates?.['BM2-SOURCE']?.weightsByKey?.[facts.sourceKey]
     :outcome.weightsByKey?.[facts.sourceKey];
   assert.equal(saved,facts.candidateKg,'only explicit review may persist the displayed kg');
   receipt[route]={draftKg:facts.candidateKg,uneditedApply:'BLOCKED',reviewedApply:'PASS',savedKg:saved};
 }
 assert.deepEqual(errors,[]);
 await writeFile(resolve(out,'glrd-source-review-popup-receipt.json'),JSON.stringify({...receipt,errors},null,2));
 console.log('GLRD uploaded-source browser modal replay PASS',JSON.stringify({branches:facts.branches,nodes:facts.nodes,
   reviewed:facts.reviewIssues,excludedNonPhysical:facts.excludedNonPhysical,sourceKey:facts.sourceKey,flangeKg:facts.candidateKg,fullPrefilled,
   proposalByType:facts.proposalByType,noDraftReasons:facts.noDraftReasons}));
} catch(e){
 await writeFile(resolve(out,'glrd-source-review-popup-receipt.json'),JSON.stringify({...receipt,error:String(e),errors},null,2));
 throw e;
} finally {await browser.close();}
