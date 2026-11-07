// Real GLRD browser engine E2E, not a Python CLI substitute.
// 109 simulated explicitly reviewed physical masses plus 5 intentional 0 kg
// skips. Exercises API -> run parity -> Pyodide -> runtime_custody.py -> CII.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const inputDir=process.env.GLRD_INPUT_DIR || '/tmp/glrd-inputs';
const artifact=resolve('artifacts/glrd-browser-pyodide-cii');
await mkdir(artifact,{recursive:true});
const [xml,staged,rawConfig]=await Promise.all([
  readFile(resolve(inputDir,'GLRD-1000-PI-01 - BM2.xml'),'utf8'),
  readFile(resolve(inputDir,'STF_2026Nov03-0839_managed_stage.json'),'utf8'),
  readFile(resolve('artifacts/glrd-review-choices/glrd-109-reviewed-five-skipped-config.json'),'utf8'),
]);
const config=JSON.parse(rawConfig);
const weights=config.overrides?.rigidWeight||{};
const skips=config.overrides?.rigidWeightSkipped||{};
const receipts=config.overrides?.rigidWeightReviewReceipts||{};
assert.equal(Object.keys(weights).length,109);
assert.equal(Object.keys(skips).length,5);
assert.equal(Object.keys(receipts).length,109);
assert.equal(Object.keys(weights).some(k=>Object.hasOwn(skips,k)),false);
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const pageErrors=[];
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  page.on('pageerror',err=>pageErrors.push(String(err)));
  page.on('console',message=>{
    if(message.type()==='error')pageErrors.push('browser console: '+message.text());
  });
  await page.goto((process.env.EMPIRICAL_BROWSER_BASE_URL || 'http://127.0.0.1:4173')+
    '/tests/fixtures/empirical-weight-nearest-browser.html',{waitUntil:'domcontentloaded'});

  const result=await page.evaluate(async ({xml,staged,config})=>{
    const {runXmlCii2019Workflow}=await import('/tabs/xml-cii-2019-standalone/xml-cii-workflow-api-atta-default.js');
    const job={
      sourceKind:'xml',sourceText:xml,sourceName:'GLRD-1000-PI-01 - BM2.xml',
      stagedJsonText:staged,supportConfigJson:JSON.stringify(config),
      options:{
        coordsMode:'first',kgToNewton:true,splitCondensedValveFlange:true,
        useRestraintTypeBasedOnJson:true,outputMode:'both',
        inputXmlOutputMode:'full-document',
        pointPropertiesBasis:'auto',
        inputXmlRestraintPolicy:'merge-existing-and-dtxr-derived-restraints',
        fillSentinelFromLineContext:true,normalizePressureCaseNames:true,
        escapeXmlAttributes:true,
      },
      weightOverrides:{},previewFacts:[],manualFacts:[],supportMapperRules:[],sifFacts:[],
    };
    const t=performance.now();
    const r=await runXmlCii2019Workflow(job);
    return {
      ok:r.ok === true,error:r.error||'',elapsedMs:Math.round(performance.now()-t),
      outputKind:r.outputKind||'',enrichedBytes:r.enrichedText?.length||0,
      ciiBytes:r.ciiText?.length||0,
      ciiText:r.ciiText||'',
      diagnostics:r.diagnostics||null,
      logTail:(r.logs||[]).slice(-36),
    };
  },{xml,staged,config});
  const cii=result.ciiText||'';
  const receipt={
    schema:'GLRD-PYODIDE-CII-AFTER-EXPLICIT-ZERO-SKIP-R1',
    reviewedPositiveMasses:109,explicitNumericZeroSkips:5,
    outputKind:result.outputKind,ok:result.ok,
    enrichedBytes:result.enrichedBytes,ciiBytes:result.ciiBytes,
    elapsedMs:result.elapsedMs,error:result.error,
    diagnostics:result.diagnostics,logTail:result.logTail,
    browserErrors:pageErrors,
  };
  await writeFile(resolve(artifact,'glrd-browser-pyodide-writer-receipt.json'),
    JSON.stringify(receipt,null,2));
  if(cii)await writeFile(resolve(artifact,'glrd-browser-pyodide-109reviewed-5skipped.cii'),cii);
  console.log('GLRD_BROWSER_PYODIDE_CII_RECEIPT',JSON.stringify({
    ok:receipt.ok,enrichedBytes:receipt.enrichedBytes,ciiBytes:receipt.ciiBytes,
    error:receipt.error,elapsedMs:receipt.elapsedMs,
    logTail:receipt.logTail.slice(-8),browserErrors:pageErrors.slice(-4),
  }));
  assert.equal(result.ok,true,'Pyodide CII workflow failed: '+result.error+
    '\n'+result.logTail.slice(-12).join('\n'));
  assert.ok(result.enrichedBytes>100000,'GLRD browser must emit enriched XML');
  assert.ok(result.ciiBytes>10000,'GLRD browser must produce actual CII output');
  assert.match(cii,/#\$\s+RIGID/,'actual native CII RIGID output required');
  assert.ok(!pageErrors.some(x=>x.includes('ModuleNotFoundError')),
    'No dynamically missing Python runtime module allowed');
  console.log('GLRD_BROWSER_PYODIDE_CII_AFTER_SKIP_PASS',JSON.stringify({
    enrichedBytes:result.enrichedBytes,ciiBytes:result.ciiBytes,skips:5,reviewed:109
  }));
} finally {await browser.close();}
