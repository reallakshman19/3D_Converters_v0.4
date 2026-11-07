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
   const mode=await collectModeARigidWeightReviewIssues({sourceText:xml,stagedJsonText:stage},config);
   const mutated=raw.map(row=>{
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
     modeReviewRows:mode.length,sourceBoreConflicts,sourceBoreHolds:fixed.filter(r=>r.sourceBoreHold).length,
     targets,stats,mismatches,pcCount:pc.length,pcPreviewCount:pcPreview.filter(r=>r.unknownComponentSuggestion?.ok).length,
     fullBoreRef27507:{boreMm:exact?.boreMm,rating:exact?.rating,
       componentType:exact?.componentType,dtxr:exact?.dtxr,
       sourceFamily:fb?.physicalFamily,nearbyRefs,
       lengthMm:exact?.lengthMm,
       type:fb?.best?.typeDesc,kg:fb?.best?.selectedWeight}};
 },{xml,stage,masterRows});
 console.log('GLRD_PRECHECK',JSON.stringify({targets:data.targets,
     sourceBoreHolds:data.sourceBoreHolds,ranked:data.stats,
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
 assert.equal(data.fullBoreRef27507.type?.toUpperCase().includes('FULL BORE'),true,'FB must not use RB');
 assert.ok(data.stats.checked>=100,'must audit most original 135 weight-bearing components');
 await writeFile(out+'/glrd-bore-family-receipt.json',
   JSON.stringify({...data,sourceSha256:sha(xml),stagedSha256:sha(stage),masterRows:masterRows.length,
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
