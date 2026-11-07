import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

const input=process.env.GLRD_INPUT_DIR||'/tmp/glrd-inputs';
const out=resolve('artifacts/glrd-bore-family');
await mkdir(out,{recursive:true});
const xml=await readFile(resolve(input,'GLRD-1000-PI-01 - BM2.xml'),'utf8');
const stage=await readFile(resolve(input,'STF_2026Nov03-0839_managed_stage.json'),'utf8');
const masterRows=JSON.parse(await readFile(resolve(input,'wtValveweights.json'),'utf8'));
const sha=x=>createHash('sha256').update(x).digest('hex');
assert.equal(sha(xml),'6bcc477860fdbe9a80159839bf476a8c1e6ce7a966587a25bc62498709843151');
assert.equal(sha(stage),'1d2469fe05d712cd1dd2da9913a840516ae686fb1616eb6d7b5e14d8918e2746');
assert.equal(masterRows.length,1595);
const errors=[];
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto((process.env.EMPIRICAL_BROWSER_BASE_URL||'http://127.0.0.1:4173')+
   '/tests/fixtures/empirical-weight-nearest-browser.html',{waitUntil:'domcontentloaded'});
 const data=await page.evaluate(async ({xml,stage,masterRows})=>{
   const {collectXmlCiiWeightMatchRows,reconcileXmlCiiWeightMatchSourceBores}=
     await import('/converters/xml-cii2019-core/weight-match-model.js?v=20261107-glrd-bore-family-r2');
   const {rankXmlCiiWeightCandidates,classifySourceWeightFamily,
     isWeightMasterPhysicalFamilyMatch}=
     await import('/converters/xml-cii2019-core/weight-valve-hints.js?v=20261107-glrd-bore-family-r2');
   const {collectModeARigidWeightReviewIssues}=
     await import('/tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a.js?v=20261107-glrd-bore-family-r2');
   const {applyXmlCiiStagedGeometryAuthority}=
     await import('/converters/xml-cii2019-core/staged-geometry-authority.js');
   const {applyXmlCiiFlangeWeightFallbackToIssue}=
     await import('/converters/xml-cii2019-core/flange-weight-fallback.js');
   const d=new DOMParser().parseFromString(xml,'application/xml');
   const allBranches=[...d.getElementsByTagName('Branch')];
   const ratings={};
   for(const b of allBranches){
     const name=b.getElementsByTagName('Branchname')[0]?.textContent||'';
     const p=name.match(/-(\d{5})-\d{2}\/B\d+$/)?.[1];
     if(!p || !({'93833':900,'13451':150})[p])throw Error('Missing pinned GLRD class authority: '+name);
     ratings[name]=({'93833':900,'13451':150})[p];
   }
   const config={weight:{masterRows},overrides:{rating:ratings}};
   const raw=collectXmlCiiWeightMatchRows(xml,stage,config);
   const projection=applyXmlCiiStagedGeometryAuthority(xml,stage,{config});
   const projected=collectXmlCiiWeightMatchRows(projection.xmlText||xml,stage,config);
   const mode=await collectModeARigidWeightReviewIssues({sourceText:xml,stagedJsonText:stage},config);
   const mutated=projected.map(row=>{
     const ref=String(row.componentRefNo||'');
     return /\/(8045|8050|8014)$/.test(ref)
       ? {...row,boreMm:ref.endsWith('/8045')?200:100} : {...row};
   });
   const fixed=reconcileXmlCiiWeightMatchSourceBores(mutated,xml);
   const byRef=(rows,needle)=>rows.find(r=>String(r.componentRefNo).endsWith('/'+needle)&&
      String(r.endpoint)==='2');
   const targets=['8045','8050','8014'].map(ref=>{
     const weightMatch=byRef(fixed,ref),review=byRef(mode,ref);
     if(!weightMatch || !review)throw Error('Missing source physical ref '+ref);
     const rating=Number(weightMatch.rating)||900;
     const wmRank=rankXmlCiiWeightCandidates({...weightMatch,rating},config,{includeRejected:true});
     return {ref,sourceBore:weightMatch.boreMm,reviewBore:review.boreMm,
       projectedBore:weightMatch.projectedBoreMm,
       corrected:weightMatch.boreAuthorityMismatch,od:weightMatch.sourceOutsideDiameterMm,
       wmSuggested:wmRank.best?.selectedWeight,reviewSuggested:review.candidates?.[0]?.selectedWeight,
       wmFamily:wmRank.best?.candidateClass?.family,
       reviewFamily:review.candidates?.[0]?.candidateClass?.family};
   });
   const mismatches=[];
   const stats={checked:0,ranked:0,preferred:0,held:0};
   for(const row of fixed){
     if(!['RIGID','FLAN','VALV','VLV','INST'].some(t=>String(row.componentType).startsWith(t)))continue;
     const r=rankXmlCiiWeightCandidates(row,config,{includeRejected:true});
     const family=classifySourceWeightFamily(row);
     stats.checked++;
     const options=r.candidates.filter(x=>Number(x.selectedWeight)>0);
     if(options.length)stats.ranked++;else stats.held++;
     if(r.best?.preferred)stats.preferred++;
     for(const cand of options){
       if(!isWeightMasterPhysicalFamilyMatch(cand,family))
         mismatches.push({ref:row.componentRefNo,family,candidate:cand.typeDesc});
     }
   }
   const pc=[
     ...fixed.filter(r=>String(r.componentType).toUpperCase()==='PCOM')
   ];
   const pcPreview=pc.map(row=>applyXmlCiiFlangeWeightFallbackToIssue(row,config));
   const exact=byRef(fixed,'27507');
   const fb=exact&&rankXmlCiiWeightCandidates(exact,config,{includeRejected:true});
   const nearbyRefs=fixed.filter(r=>String(r.componentRefNo||'').includes('/27507'))
      .map(r=>({ref:r.componentRefNo,endpoint:r.endpoint,boreMm:r.boreMm,
        dtxr:r.dtxr,componentType:r.componentType,rating:r.rating,lengthMm:r.lengthMm}));
   const sourceBoreConflicts=fixed.filter(r=>r.boreAuthorityMismatch).length;
   return {branches:allBranches.length,rawWeightMatchRows:raw.length,
     projectedWeightMatchRows:projected.length,
     projectedNewSources:projected.filter(r=>!raw.some(q=>q.branchName===r.branchName &&
       q.componentRefNo===r.componentRefNo && q.endpoint===r.endpoint)).length,
     modeReviewRows:mode.length,sourceBoreConflicts,sourceBoreHolds:fixed.filter(r=>r.sourceBoreHold).length,
     targets,stats,mismatches,pcCount:pc.length,pcPreviewCount:pcPreview.filter(r=>r.unknownComponentSuggestion?.ok).length,
     fullBoreRef27507:{boreMm:exact?.boreMm,rating:exact?.rating,
       componentType:exact?.componentType,dtxr:exact?.dtxr,
       sourceFamily:fb?.physicalFamily,nearbyRefs,
       lengthMm:exact?.lengthMm,
       type:fb?.best?.typeDesc,kg:fb?.best?.selectedWeight}};
 },{xml,stage,masterRows});
 console.log('GLRD_PRECHECK',JSON.stringify({targets:data.targets,
     sourceBoreHolds:data.sourceBoreHolds,rawRows:data.rawWeightMatchRows,projectedRows:data.projectedWeightMatchRows,
     newSources:data.projectedNewSources,ranked:data.stats,
     fb:data.fullBoreRef27507,pcCount:data.pcCount}));
 await writeFile(out+'/glrd-bore-family-precheck.json',JSON.stringify(data,null,2));
 assert.equal(data.branches,31);
 assert.equal(data.targets.length,3);
 for(const t of data.targets){
   assert.equal(t.sourceBore,150,t.ref+' original physical DN');
   assert.equal(t.reviewBore,150,t.ref+' consolidated source DN');
   assert.equal(t.corrected,true,t.ref+' projected mismatch must be visible');
   assert.equal(Number(t.od),168.3,t.ref+' source OD');
   assert.equal(Number(t.wmSuggested),Number(t.reviewSuggested),t.ref+' same master mass');
 }
 assert.equal(data.mismatches.length,0,JSON.stringify(data.mismatches.slice(0,4)));
 assert.equal(data.sourceBoreHolds,0,'the original real GLRD refs must resolve unambiguously');
 assert.equal(data.pcCount,14,'14 source PCOMs remain visible');
 assert.ok(data.pcPreviewCount>=10,'Unknown PCOM physical estimates remain in sidecar');
 if(data.fullBoreRef27507.nearbyRefs.length){
   assert.equal(data.fullBoreRef27507.type?.toUpperCase().includes('FULL BORE'),true,'FB must not use RB');
 }
 assert.ok(data.stats.checked>=100,'must audit most original 135 weight-bearing components');

 // Render the REAL Weight Match panel, not a model of its table. Preview
 // Ratings are supplied as the 31-branch pinned 93833/13451 authority.
 await page.evaluate(async ({xml,stage,masterRows})=>{
   const {publishXmlCiiPreviewRatingSnapshot}=
     await import('/converters/xml-cii2019-core/preview-rating-snapshot.js');
   const {applyXmlCiiStagedGeometryAuthority}=
     await import('/converters/xml-cii2019-core/staged-geometry-authority.js');
   const {xmlCiiRenderWeightMatchPhase,bindXmlCiiWeightMatchPhase}=
     await import('/tabs/model-converters/converters/xmltocii2019_helper/weight-match-renderer.js?v=20261107-glrd-bore-family-r2');
   const d=new DOMParser().parseFromString(xml,'application/xml');
   const branches=[...d.getElementsByTagName('Branch')];
   const preview=branches.map(b=>{
     const branchName=b.getElementsByTagName('Branchname')[0]?.textContent||'';
     const p=branchName.match(/-(\d{5})-\d{2}\/B\d+$/)?.[1];
     return {branchName,rating:({'93833':900,'13451':150})[p]};
   });
   if(preview.length!==31 || preview.some(x=>!x.rating))throw Error('No 31-branch Preview Rating authority');
   publishXmlCiiPreviewRatingSnapshot(preview,{authorityDigest:'pinned-owner-GLRD-manual-preview'});
   const config={weight:{masterRows},overrides:{rating:Object.fromEntries(preview.map(x=>[x.branchName,x.rating]))}};
   const section=document.createElement('section');
   section.id='glrd-actual-weight-match-panel';
   section.innerHTML=xmlCiiRenderWeightMatchPhase();
   document.body.appendChild(section);
   const projected=applyXmlCiiStagedGeometryAuthority(xml,stage,{config});
   const file=new File([xml],'GLRD-1000-PI-01 - BM2.xml',{type:'application/xml'});
   window.__glrdWeightMatchSaveCount=0;
   window.__glrdWeightMatchSavedConfig=null;
   bindXmlCiiWeightMatchPhase(section,{
     xmlFile:file,stagedJsonText:stage,config,
     // The renderer itself applies staged geometry exactly once. Feeding an
     // already projected XML here would double-apply that same transform.
     enrichXmlForCii2019:async()=>({xmlText:xml,config}),
     onSaveConfig:cfg=>{
       window.__glrdWeightMatchSaveCount++;
       window.__glrdWeightMatchSavedConfig=cfg;
     },
     ensureOverrides:c=>(c.overrides||={}),
     resolveStagedJsonText:async()=>({text:stage,label:'Owner pinned stage'}),
   });
   section.querySelector('#mc-wm-refresh').click();
 },{xml,stage,masterRows});
 await page.waitForFunction(()=>{
   const panel=document.querySelector('#glrd-actual-weight-match-panel');
   const rows=panel?.querySelectorAll('.mc-rigid-review-table-wrap tbody tr').length||0;
   return rows>0 || panel?.querySelector('#mc-wm-status')?.textContent==='Error';
 },null,{timeout:18000}).catch(()=>{});
 const diagnostic=await page.evaluate(()=>{
   const panel=document.querySelector('#glrd-actual-weight-match-panel');
   return {panel:!!panel,tableRows:panel?.querySelectorAll('.mc-rigid-review-table-wrap tbody tr').length||0,
     status:panel?.querySelector('#mc-wm-status')?.textContent||'',
     text:panel?.querySelector('#mc-wm-content')?.textContent?.slice(0,600)||''};
 });
 console.log('GLRD_WEIGHT_MATCH_RENDER_DIAGNOSTIC',JSON.stringify({...diagnostic,pageErrors:errors}));
 await writeFile(out+'/glrd-weight-match-ui-precheck.json',JSON.stringify({...diagnostic,pageErrors:errors},null,2));
 assert.ok(diagnostic.tableRows>0,'live Weight Match should render a review table: '+JSON.stringify(diagnostic));
 const rendered=await page.evaluate(()=>{
   const panel=document.querySelector('#glrd-actual-weight-match-panel');
   const rows=[...panel.querySelectorAll('.mc-rigid-review-table-wrap tbody tr')];
   const byRef=ref=>rows.find(tr=>tr.querySelectorAll('td')[7]?.textContent?.includes('/'+ref+'_2'));
   const read=ref=>{
     const tr=byRef(ref),td=tr?[...tr.querySelectorAll('td')]:[];
     return {ref,present:!!tr,status:td[0]?.textContent?.trim()||'',bore:td[4]?.textContent?.trim()||'',
       boreEvidence:td[4]?.title||'',rating:td[5]?.textContent?.trim()||'',
       suggestion:td[12]?.textContent?.trim()||'',
       candidateButtons:td[12]?.querySelectorAll('[data-wm-candidate]').length||0,
       advisoryChips:td[12]?.querySelectorAll('[data-advisory-weight]').length||0};
   };
   const draftRows=rows.filter(tr=>{
     const input=tr.querySelector('.mc-rigid-review-input[data-wm-proposal-draft="estimate"]');
     return input && Number(input.value)>0;
   });
   const multipleChoiceRows=rows.filter(tr=>tr.querySelectorAll('[data-wm-choice]').length>1);
   return {rows:rows.length,summary:panel.querySelector('#mc-wm-status')?.textContent||'',
     draftPreloaded: draftRows.length,
     multipleChoiceRows: multipleChoiceRows.length,
     sourceMassAutoCommitted:false,
     noSourceWrites:panel.querySelectorAll('[data-wm-candidate]').length===0,
     targetRefs:['8045','8050','8014','27507'].map(read)};
 });
 console.log('GLRD_ACTUAL_WEIGHT_MATCH_UI',JSON.stringify(rendered));
 assert.equal(rendered.rows,149,'real Weight Match must include original 135 components plus 14 PCOM');
 assert.ok(rendered.draftPreloaded>=135,'Weight Match must actually prefill most source rows as REVIEW-ONLY drafts');
 assert.ok(rendered.multipleChoiceRows>0,'Weight Match must show multiple physical-length master alternatives');
 assert.equal(rendered.noSourceWrites,true,'no approved-source mass via prior direct candidate buttons');
 assert.match(rendered.summary,/0 unresolved/,'rows with advisory candidates are not unresolved');
 assert.ok(rendered.targetRefs.every(r=>r.status!=='Unresolved'),'display valid proposals as Review candidate');
 for(const ref of ['8045','8050','8014']){
   const row=rendered.targetRefs.find(x=>x.ref===ref);
   assert.equal(row.bore,'150 mm *',ref+' displayed corrected source DN');
   assert.match(row.boreEvidence,/Source OD 168\.3 mm/,ref+' source OD provenance');
   assert.match(row.suggestion,/59(?:\.0+)?\s*kg/,ref+' visible master kg');
   assert.ok(row.advisoryChips>0,'unapproved master remains an advisory chip');
 }
 const fbRow=rendered.targetRefs.find(x=>x.ref==='27507');
 assert.equal(fbRow.bore,'50 mm','Full-bore VALV source DN');
 assert.match(fbRow.suggestion,/56\.001\s*kg/);
 assert.doesNotMatch(fbRow.suggestion,/47\.001\s*kg/,'must not show reduced-bore mass');
 await page.screenshot({path:resolve(out,'glrd-actual-weight-match-reconciled.png')});

 // Critical UI authority check: an alternative Class/DN master reference is
 // only a draft until a reviewer explicitly ticks Reviewed AND clicks Save.
 const row=page.locator('#glrd-actual-weight-match-panel .mc-rigid-review-table tbody tr')
   .filter({hasText:'/27507_2'}).first();
 assert.equal(await row.count(),1,'real Owner full-bore source row exists');
 const preSave=await page.evaluate(()=>({
   saves:window.__glrdWeightMatchSaveCount,
   sourceMassEntries:Object.keys(window.__glrdWeightMatchSavedConfig?.overrides?.rigidWeight||{}).length
 }));
 assert.deepEqual(preSave,{saves:0,sourceMassEntries:0},
   '149 prefilled Weight Match values must not save any source mass');
 await row.locator('[data-wm-choice-index="1"]').click();
 assert.equal(await row.locator('.mc-rigid-review-input').getAttribute('data-wm-proposal-draft'),'estimate');
 assert.equal(await row.locator('[data-wm-verified]').isChecked(),false);
 await row.locator('[data-wm-save-reviewed]').click();
 assert.equal(await page.evaluate(()=>window.__glrdWeightMatchSaveCount),0,
   'unreviewed comparison-only candidate must NOT persist');
 await row.locator('[data-wm-verified]').check();
 await row.locator('[data-wm-save-reviewed]').click();
 const reviewedSaved=await page.evaluate(()=>({
   saves:window.__glrdWeightMatchSaveCount,
   weights:window.__glrdWeightMatchSavedConfig?.overrides?.rigidWeight||{}
 }));
 assert.equal(reviewedSaved.saves,1,'only explicit Reviewed + Save may persist physical kg');
 assert.equal(Object.keys(reviewedSaved.weights).length,1,
   'reviewed single component must never approve 148 other preloads');

 await writeFile(out+'/glrd-bore-family-receipt.json',
   JSON.stringify({...data,renderedWeightMatch:rendered,reviewedSingleSave:{
     saveCount:reviewedSaved.saves,keys:Object.keys(reviewedSaved.weights)},
     sourceSha256:sha(xml),stagedSha256:sha(stage),masterRows:masterRows.length,
     safety:'unapproved catalog candidates are advisory; no XML/CII mass write',
     errors},null,2));
 assert.deepEqual(errors,[]);
 console.log('GLRD_BORE_FAMILY_135_PLUS_14_PASS',JSON.stringify({
   sourceDNs:data.targets.map(x=>[x.ref,x.sourceBore,x.projectedBore]),
   physicalRowsChecked:data.stats.checked,ranked:data.stats.ranked,
   held:data.stats.held,noWrongFamily:data.mismatches.length===0,
   pcCount:data.pcCount,reviewRows:data.modeReviewRows,
   ref27507:data.fullBoreRef27507}));
} finally {await browser.close()}
