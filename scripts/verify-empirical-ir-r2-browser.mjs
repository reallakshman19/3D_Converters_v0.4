import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const base=process.env.EMPIRICAL_BROWSER_BASE_URL||'http://127.0.0.1:4173';
const dir=resolve(process.env.EMPIRICAL_BROWSER_ARTIFACT_DIR||'artifacts/empirical-unknown-browser');
await mkdir(dir,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:920}});
const errors=[]; page.on('pageerror',e=>errors.push(String(e)));
const lengths=[
  {L:115,weight:15,family:'Weldneck Flange'},
  {L:115.001,weight:14.688,family:'Flanged Ball Valve-Reduced Bore'},
  {L:147,weight:18.774,family:'Flanged Ball Valve-Reduced Bore'},
  {L:371.2,weight:47.409,family:'Flanged Ball Valve-Reduced Bore'}
];
const receipt={schema:'empirical-ir-r2-live-browser/v1',cases:[],
  limits:['NO OWNER GLRD PYODIDE','NO EMITTED CII MASS CONSERVATION','EXPOSED REVIEW']};
try {
  await page.goto(base+'/tests/fixtures/empirical-weight-nearest-browser.html',{waitUntil:'domcontentloaded'});
  const facts=await page.evaluate(async lengths=>{
    const {DEFAULT_WEIGHT_MASTER_ROWS:rows}=await import('/converters/xml-cii2019-core/default-weight-master-rows.js');
    const {rankXmlCiiWeightCandidates}=await import('/converters/xml-cii2019-core/weight-valve-hints.js');
    const {sourceFactsIndex,standaloneWeightIssueFromDryRunNode}=
      await import('/tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-weight-match.js');
    const {applyXmlCiiFlangeWeightFallbackToIssue:strict}=
      await import('/converters/xml-cii2019-core/flange-weight-fallback.js');
    const cfg={weight:{masterRows:rows}};
    return lengths.map(({L})=>{
      const mkNode=(ep,kg)=>'<Node><NodeNumber>'+(ep===1?'10019':'10020')+
        '</NodeNumber><ComponentRefNo>=TEST/UNKNOWN</ComponentRefNo><Endpoint>'+
        ep+'</Endpoint><ComponentType>RIGID</ComponentType><Weight>'+kg+
        '</Weight><Position>0 0 '+(ep===1?'0':L)+'</Position></Node>';
      const xml=(kg)=>'<PipeStressExport><Pipe><Branch><Branchname>B1</Branchname>'+
        mkNode(1,0)+mkNode(2,kg)+'</Branch></Pipe></PipeStressExport>';
      const rank=rankXmlCiiWeightCandidates({boreMm:50,rating:900,lengthMm:L},cfg);
      const nr={key:'B1::10020',branchName:'B1',nodeNumber:'10020',
        componentType:'RIGID',componentRefNo:'=TEST/UNKNOWN',endpoint:'2',
        boreMm:50,rating:900,lengthMm:L+100,weightMatch:rank.best,
        weightCandidates:rank.candidates,rejectedWeightCandidates:rank.rejectedCandidates};
      const raw=standaloneWeightIssueFromDryRunNode(nr,cfg,sourceFactsIndex(xml(0)));
      const r=strict(raw,cfg);
      const actual=standaloneWeightIssueFromDryRunNode(nr,cfg,sourceFactsIndex(xml(21)));
      const override=standaloneWeightIssueFromDryRunNode(
        nr,{...cfg,overrides:{rigidWeight:{'B1::10020':23}}},sourceFactsIndex(xml(0)));
      return {L,mapped:raw.mapped,mass:raw.weight,lengthSource:raw.elementLengthSource,
        physicalLength:raw.lengthMm,advisoryKg:r.unknownComponentSuggestion?.suggestedKg,
        rankedCandidateKg:r.ranking.best?.selectedWeight ?? null,
        family:r.unknownComponentSuggestion?.referenceFamily,
        sourceMapped:actual.mapped,sourceMass:actual.weight,
        overrideMapped:override.mapped,overrideMass:override.weight};
    });
  },lengths);
  for(let i=0;i<lengths.length;i++){
    const f=facts[i],expected=lengths[i];
    assert.equal(f.mapped,false); assert.equal(f.mass,0);
    assert.equal(f.lengthSource,'component-ref-endpoint-span');
    assert.ok(Math.abs(f.physicalLength-expected.L)<1e-7);
    assert.equal(f.advisoryKg,expected.weight);assert.equal(f.family,expected.family);
    assert.equal(f.sourceMapped,true);assert.equal(f.sourceMass,21);
    assert.equal(f.overrideMapped,true);assert.equal(f.overrideMass,23);
  }
  receipt.sourceFacts=facts;
  for(const route of ['single','atta','modeA']){
    for(const expected of lengths){
      const {L,weight,family}=expected;
      await page.evaluate(async ({route,L,weight,family})=>{
        const candidate={suggestedWeight:weight,selectedWeight:weight,weight,
          referenceFamily:family,inferredWeight:true,fallbackSuggestion:true,
          massAuthority:'ESTIMATE_ONLY_NOT_APPROVED_COMPONENT_MASS',
          engineeringMassApproved:false,acceptedForCii:false,preferred:false};
        const issue={key:'B1::10020',branchName:'B1',nodeNumber:'10020',
          boreMm:50,rating:900,lengthMm:L,componentType:'RIGID',
          componentRefNo:'=TEST/UNKNOWN',candidates:[candidate],
          dtxr:'',fileName:'synthetic.xml',sourceId:'SRC-A'};
        if(route==='modeA'){
          const m=await import('/tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a.js');
          window.__promise=m.openModeAConsolidatedRigidWeightReviewPopup([
            {sourceId:'SRC-A',fileName:'synthetic.xml',issues:[issue]}
          ]);
          const tools=await import('/tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-mode-a-rigid-review-tools.js');
          tools.installModeAConsolidatedRigidReviewTools();
        }else{
          const file=route==='atta'?'xml-cii-adapted-run-workflow-atta-default.js':'xml-cii-adapted-run-workflow.js';
          const m=await import('/tabs/xml-cii-2019-standalone/ui-adapted/'+file);
          window.__promise=m.openStandaloneRigidWeightReviewPopup([issue],{current:{}},{});
        }
      },{route,L,weight,family});
      const input=page.locator('.mc-rigid-review-input');
      assert.equal(await input.count(),1);
      assert.equal(await input.inputValue(),'','unknown mass must start blank');
      const chip=page.locator(route==='modeA'?'[data-mode-a-rigid-advisory]':'[data-rigid-review-advisory]');
      assert.equal(await chip.count(),1);
      assert.ok((await chip.innerText()).includes(family),'selected reference family visible');
      assert.equal(await page.locator('[data-mode-a-rigid-candidate],[data-rigid-review-candidate]').count(),0);
      if(route==='modeA'){
        await page.locator('[data-mode-a-rigid-fill-exact]').click();
        assert.equal(await input.inputValue(),'');
        await page.locator('[data-mode-a-rigid-fill-all-suggestions]').click();
      }else await page.locator('[data-rigid-review-fill-best]').click();
      assert.equal(await input.inputValue(),'','bulk must not promote empirical mass');
      const apply=page.locator(route==='modeA'?'[data-mode-a-rigid-apply]':'[data-rigid-review-apply]');
      await apply.click();
      assert.equal(await input.inputValue(),'','unedited Apply stays blocked');
      const status=page.locator(route==='modeA'?'[data-mode-a-rigid-status]':'[data-rigid-review-status]');
      assert.match(await status.innerText(),/Enter a positive weight/i);
      if(route==='single'&&L===371.2)
        await page.screenshot({path:resolve(dir,'r2-single-unedited-apply-hold.png'),fullPage:true});
      if(route==='modeA'&&L===115)
        await page.screenshot({path:resolve(dir,'r2-mode-a-unedited-apply-hold.png'),fullPage:true});
      await input.fill('21');
      await apply.click();
      const outcome=await page.evaluate(async()=>await window.__promise);
      const manual=route==='modeA'
        ?outcome.updates?.['SRC-A']?.weightsByKey?.['B1::10020']
        :outcome.weightsByKey?.['B1::10020'];
      assert.equal(manual,21,'manual operator input persists');
      const parity=await page.evaluate(async mass=>{
        const {mappedNodeWeights}=await import('/tabs/xml-cii-2019-standalone/xml-cii-standalone-run-parity.js');
        const nodes=[{key:'B1::10020',branchName:'B1',nodeNumber:'10020',componentType:'RIGID',
          weightMatch:{weight:47.409,inferredWeight:true}}];
        const none=mappedNodeWeights(nodes,{overrides:{rigidWeight:{}}});
        const reviewed=mappedNodeWeights(nodes,{overrides:{rigidWeight:{'B1::10020':mass}}});
        return {before:none.size,after:reviewed.get('B1|10020')};
      },manual);
      assert.equal(parity.before,0);assert.equal(parity.after,21);
      receipt.cases.push({route,lengthMm:L,reference:family,advisoryKg:weight,
        uneditedApply:'BLOCKED',bulk:'BLOCKED',manualKg:21,plannedBefore:0,plannedAfter:21});
    }
  }

  // Positive control: an expressly approved source-mass candidate can be
  // selected, but is NOT a prefill. No inferred candidate can mimic this.
  for(const route of ['single','atta','modeA']){
    await page.evaluate(async route=>{
      const candidate={suggestedWeight:22,weight:22,selectedWeight:22,
        massAuthority:'APPROVED_SOURCE_MASS',engineeringMassApproved:true,
        acceptedForCii:true,preferred:true,inferredWeight:false,
        fallbackSuggestion:false,zeroFallback:false,referenceFamily:'Verified source'};
      const issue={key:'B1::10020',branchName:'B1',nodeNumber:'10020',
        componentType:'RIGID',boreMm:50,rating:900,lengthMm:115,
        candidates:[candidate],fileName:'source.xml',sourceId:'SRC-A'};
      if(route==='modeA'){
        const m=await import('/tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a.js');
        window.__promise=m.openModeAConsolidatedRigidWeightReviewPopup([
          {sourceId:'SRC-A',fileName:'source.xml',issues:[issue]}
        ]);
        const t=await import('/tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-mode-a-rigid-review-tools.js');
        t.installModeAConsolidatedRigidReviewTools();
      }else{
        const file=route==='atta'?'xml-cii-adapted-run-workflow-atta-default.js':'xml-cii-adapted-run-workflow.js';
        const m=await import('/tabs/xml-cii-2019-standalone/ui-adapted/'+file);
        window.__promise=m.openStandaloneRigidWeightReviewPopup([issue],{current:{}},{});
      }
    },route);
    const input=page.locator('.mc-rigid-review-input');
    assert.equal(await input.inputValue(),'','even approved candidate requires deliberate selection');
    if(route==='modeA') await page.locator('[data-mode-a-rigid-fill-exact]').click();
    else await page.locator('[data-rigid-review-fill-best]').click();
    assert.equal(await input.inputValue(),'22');
    await page.locator(route==='modeA'?'[data-mode-a-rigid-apply]':'[data-rigid-review-apply]').click();
    const saved=await page.evaluate(async()=>await window.__promise);
    assert.equal(route==='modeA'
      ?saved.updates?.['SRC-A']?.weightsByKey?.['B1::10020']
      :saved.weightsByKey?.['B1::10020'],22);
    receipt.cases.push({route,control:'explicit approved source candidate',
      initialBlank:true,explicitSelectionKg:22});
  }
  // Verify the actual XML override writer, not merely a preview's mass plan.
  const serialized=await page.evaluate(async()=>{
    const {applyXmlCiiRigidWeightOverrides}=await import('/converters/xml-cii2019-core/weight-match-model.js');
    const xml='<PipeStressExport><Pipe><Branch><Branchname>B1</Branchname>'+
      '<Node><NodeNumber>10020</NodeNumber><ComponentType>RIGID</ComponentType>'+
      '<ComponentRefNo>=TEST/UNKNOWN</ComponentRefNo><Endpoint>2</Endpoint>'+
      '<Weight>0</Weight><Position>0 0 115</Position></Node>'+
      '</Branch></Pipe></PipeStressExport>';
    const none=applyXmlCiiRigidWeightOverrides(xml,{});
    const manual=applyXmlCiiRigidWeightOverrides(xml,{'B1::10020':21});
    return {noneCount:none.appliedCount,
      noneWeight:new DOMParser().parseFromString(none.xmlText,'application/xml').getElementsByTagName('Weight')[0].textContent,
      manualCount:manual.appliedCount,manualWeight:new DOMParser()
        .parseFromString(manual.xmlText,'application/xml')
        .getElementsByTagName('Weight')[0].textContent};
  });
  assert.equal(serialized.noneCount,0);
  assert.equal(serialized.noneWeight,'0');
  assert.equal(serialized.manualCount,1);
  assert.equal(serialized.manualWeight,'21');
  receipt.xmlWriterControl=serialized;


  // Smart-fill enhancement is another live UI path. No candidate with
  // merely empirical authority can become a "SAFE" fill in that toolbar.
  await page.evaluate(async()=>{
    const m=await import('/tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-run-workflow.js');
    const issue={key:'B1::10020',branchName:'B1',nodeNumber:'10020',
      componentType:'RIGID',boreMm:50,rating:900,lengthMm:147,
      candidates:[{suggestedWeight:18.774,weight:18.774,
        referenceFamily:'Flanged Ball Valve-Reduced Bore',
        preferred:true,inferredWeight:true,fallbackSuggestion:true,
        massAuthority:'ESTIMATE_ONLY_NOT_APPROVED_COMPONENT_MASS'}]};
    window.__promise=m.openStandaloneRigidWeightReviewPopup([issue],{current:{}},{});
    const smart=await import('/tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-smart-fill-ui.js');
    smart.installRigidSmartFillDashboard();
  });
  const smartButton=page.locator('button[title="Fill safe weight suggestions"]');
  assert.equal(await smartButton.count(),1);
  assert.equal(await smartButton.isDisabled(),true);
  const smartInput=page.locator('.mc-rigid-review-input');
  assert.equal(await smartInput.inputValue(),'');
  await page.screenshot({path:resolve(dir,'r2-smart-fill-empirical-blocked.png'),fullPage:true});
  await smartInput.fill('21');
  await page.locator('[data-rigid-review-apply]').click();
  const smartResult=await page.evaluate(async()=>await window.__promise);
  assert.equal(smartResult.weightsByKey?.['B1::10020'],21);
  receipt.smartFill={unsafeEstimate:'BLOCKED',manualOperatorWeight:21};

  assert.deepEqual(errors,[]);
  await writeFile(resolve(dir,'r2-browser-receipt.json'),JSON.stringify({...receipt,errors},null,2));
  console.log('R2 browser live popup tests PASS:',receipt.cases.length);
}catch(e){
  await writeFile(resolve(dir,'r2-browser-receipt.json'),
    JSON.stringify({...receipt,error:String(e),errors},null,2));
  throw e;
}finally{await browser.close();}
