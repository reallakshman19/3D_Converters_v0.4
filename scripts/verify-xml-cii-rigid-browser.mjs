import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

// Actual browser DOMParser + real workflow-service + Output/Run panel.
// An injected engine result isolates the output custody boundary; this is
// NOT a claim of full Pyodide execution or operator/engineering approval.
const base=process.env.XML_CII_BROWSER_BASE_URL||'http://127.0.0.1:4173';
const artifactDir=resolve(process.env.XML_CII_BROWSER_ARTIFACT_DIR||'artifacts/xml-cii-rigid-mass-browser');
await mkdir(artifactDir,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];
page.on('pageerror',error=>errors.push(String(error?.message||error)));
const receipt={schema:'xml-cii-2019-rigid-mass-browser/v1',mode:'BROWSER_NATIVE_DOM_INJECTED_ENGINE',
  statements:[],notRun:['REAL_OPERATOR_TAB_NAVIGATION','REAL_PYODIDE_NATIVE_CONVERTER',
    'REAL_GLRD_OWNER_BROWSER_REPLAY','PHYSICAL_MASS_CORRECTION','INDEPENDENT_ENGINEERING_REVIEW']};
try {
  await page.goto(base+'/tests/fixtures/xml-cii-standalone/rigid-mass-browser-harness.html',
    {waitUntil:'domcontentloaded',timeout:60000});
  const result=await page.evaluate(async()=>{
    const {runXmlCii2019WorkflowService}=await import('/tabs/xml-cii-2019-standalone/xml-cii-workflow-service.js');
    const {buildStandaloneOutputRunReadiness}=await import('/tabs/xml-cii-2019-standalone/xml-cii-output-run-readiness.js');
    const {renderStandaloneOutputRunPanel}=await import('/tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-output-run.js');
    function n(no,endpoint,kind,ref,z,weight,extra=''){
      return '<Node><NodeNumber>'+no+'</NodeNumber><Endpoint>'+endpoint+
        '</Endpoint><ComponentType>'+kind+'</ComponentType>'+
        '<ComponentRefNo>'+ref+'</ComponentRefNo><Position>0 0 '+z+
        '</Position><Weight>'+weight+'</Weight>'+extra+'</Node>';
    }
    const flange='<Rating>900</Rating><BoreMm>50</BoreMm>'+
      '<DTXR_POS>WELDING NECK FLANGE SCH40</DTXR_POS>';
    const duplicateXml='<PipeStressExport><Pipe><Branch><Branchname>B1</Branchname>'+
      n(1119,2,'VALV','=A/VALVE',0,47)+
      n(-1,1,'PCOM','=A/PCOM',3.2,0)+
      n(-1,2,'PCOM','=A/PCOM',15.9,0)+
      n(10020,1,'FLAN','=A/FLANGE',19.1,15,flange)+
      n(1120,2,'RIGID','=A/FLANGE',128.1,15,flange)+
      '</Branch></Pipe></PipeStressExport>';
    function cii(edges) {
      const lines=['#$ CONTROL',edges.length+' 0 0 0 0 0',
        '0 '+edges.length+' 0 0 0 0','0 0 0 0 0 0','0',
        '#$ ELEMENTS'];
      for(const [from,to,dist,pointer,branch] of edges){
        const block=Array.from({length:15},()=> '0 0 0 0 0 0');
        block[0]=[from,to,0,dist,0,60.3].join(' ');
        block[10]=branch.length+' '+branch;
        block[12]=[0,pointer,0,0,0,0].join(' ');
        block[14]='0 0 0';
        lines.push(...block);
      }
      lines.push('#$ RIGID',...edges.map(x=>x[5]+' 0'));
      return lines.join('\n')+'\n';
    }
    async function run(xml,ciiText,{inputXml=xml,engineExtra={}}={}){
      const job={sourceKind:'xml',sourceName:'browser-synthetic.xml',
        sourceText:inputXml,supportConfigJson:'{}',options:{outputMode:'cii-only',kgToNewton:true}};
      const runtime={
        runParityEnricher:async()=>({applied:true,xmlText:inputXml,
          evidence:{ok:true,engineInputDigest:'BROWSER_SYNTHETIC'},stats:{},logs:[]}),
        engineRunner:async()=>({ok:true,sourceKind:'xml',outputKind:'enrichedXML',
          enrichedText:xml,enrichedName:'browser-enriched.xml',ciiText,
          ciiName:'browser.cii',diagnostics:{warnings:[]},logs:['INJECTED_ENGINE_NOT_PYODIDE'],...engineExtra})
      };
      return runXmlCii2019WorkflowService(job,runtime);
    }
    const dupeCii=cii([[1119,10020,19.1,1,'B1',150],[10020,1120,109,2,'B1',150]]);
    const dupe=await run(duplicateXml,dupeCii);
    const state={sourceKind:'xml',sourceText:duplicateXml,supportConfigJson:'{}',
      options:{outputMode:'cii-only',kgToNewton:true},result:dupe};
    const report=buildStandaloneOutputRunReadiness(state);
    const host=document.getElementById('output-run-qualification');
    renderStandaloneOutputRunPanel(host,state,()=>{});
    const buttons=[...host.querySelectorAll('button')].map(b=>({label:b.textContent?.trim(),disabled:b.disabled,action:b.dataset.action}));
    const heldRepairBtn=host.querySelector('[data-action="review-final-weight"]');
    const heldRepairAvailable=heldRepairBtn?.disabled===false;
    if(heldRepairAvailable)heldRepairBtn.click();
    const repairDialog=document.querySelector('.mc-rigid-review-overlay');
    const shortRow=repairDialog?.querySelector('[data-final-rigid-row][data-pointer="1"]');
    const flangeRow=repairDialog?.querySelector('[data-final-rigid-row][data-pointer="2"]');
    const repairEvidence={
      quarantinedStatus:dupe.rigidMassRepairCandidate?.status||'NONE',
      quarantinedSourceEqual:dupe.rigidMassRepairCandidate?.ciiText===dupeCii,
      releasedCiiStillBlank:dupe.ciiText==='',
      reviewButtonEnabled:heldRepairAvailable,
      heldBannerPresent:!!repairDialog?.querySelector('[data-final-rigid-engineering-hold]'),
      defaultFilter:repairDialog?.querySelector('[data-final-rigid-filter]')?.value,
      connectionShortSpan:shortRow?.dataset.finalRigidShortSpan,
      connectionAuditFlagged:shortRow?.dataset.finalRigidAuditFlagged,
      flangeAuditFlagged:flangeRow?.dataset.finalRigidAuditFlagged,
      sourceEvidence:shortRow?.querySelector('[data-final-rigid-repair-evidence]')?.textContent||'',
    };
    const evidence={
      status:dupe.diagnostics?.rigidMassAudit?.status,
      flags:dupe.diagnostics?.rigidMassAudit?.flags?.map(x=>x.code),
      elements:dupe.diagnostics?.rigidMassAudit?.rows?.map(x=>({
        from:x.from,to:x.to,pointer:x.rigidPointer,weight:x.weightN,
        ref:x.physicalComponentRef,api:x.empirical?.status})),
      ok:dupe.ok,error:dupe.error,ciiText:dupe.ciiText,
      diagnosticAvailable:report.artifactRows.find(x=>x.kind==='diagnostics')?.available,
      ciiAvailable:report.artifactRows.find(x=>x.kind==='cii')?.available,
      repairEvidence,
      buttons,
      panelText:host.innerText.slice(0,10000)
    };
    const heavyXml='<PipeStressExport><Pipe><Branch><Branchname>HEAVY</Branchname>'+
      n(9000,1,'INST','=HV',0,110)+n(9001,2,'INST','=HV',1.1,110)+
      '</Branch></Pipe></PipeStressExport>';
    const heavyCii=cii([[9000,9001,1.1,1,'HEAVY',1100]]);
    const heavy=await run(heavyXml,heavyCii);
    const originalBeforeTopoFix=heavyXml.replace('<Position>0 0 1.1</Position>',
      '<Position>0 0 9.1</Position>');
    const committedTopoFix=await run(heavyXml,heavyCii,{
      inputXml:originalBeforeTopoFix,
      engineExtra:{ciiInputSource:'topofix',topoFixCommitted:true,topoFixXmlText:heavyXml},
    });
    const missingTopoFix=await run(heavyXml,heavyCii,{
      inputXml:originalBeforeTopoFix,
      engineExtra:{ciiInputSource:'topofix',topoFixCommitted:false,topoFixXmlText:''},
    });
    const heavyState={...state,sourceText:heavyXml,result:heavy};
    const heavyReport=buildStandaloneOutputRunReadiness(heavyState);
    return {evidence,heavy:{
      ok:heavy.ok,status:heavy.diagnostics?.rigidMassAudit?.status,
      qualified:heavy.diagnostics?.rigidMassEngineeringQualified,
      weight:heavy.diagnostics?.rigidMassAudit?.rows?.[0]?.weightN,
      ciiAvailable:heavyReport.artifactRows.find(x=>x.kind==='cii')?.available,
      ciiMatches:heavy.ciiText===heavyCii},
      topoFix:{ok:committedTopoFix.ok,ciiSame:committedTopoFix.ciiText===heavyCii,
        status:committedTopoFix.diagnostics?.rigidMassAudit?.status,
        missingHeld:missingTopoFix.ok===false&&missingTopoFix.ciiText===''&&
          missingTopoFix.diagnostics?.rigidMassAudit?.errorCode==='RIGID_AUDIT_TOPOFIX_INPUT_MISSING'}
    };
  });
  assert.equal(result.evidence.ok,false);
  assert.equal(result.evidence.error,'RIGID_MASS_CONSERVATION_HOLD');
  assert.equal(result.evidence.ciiText,'');
  assert.equal(result.evidence.ciiAvailable,false);
  assert.equal(result.evidence.diagnosticAvailable,true);
  assert.equal(result.evidence.status,'HOLD');
  assert.ok(result.evidence.flags.includes('POSITIVE_WEIGHT_ON_ZERO_MASS_COMPONENT'));
  assert.ok(result.evidence.flags.includes('DUPLICATE_FULL_COMPONENT_MASS_ON_CONNECTION'));
  assert.deepEqual(result.evidence.elements.map(x=>[x.from,x.to,x.pointer,x.weight,x.ref]),[
    [1119,10020,1,150,'=A/PCOM'],[10020,1120,2,150,'=A/FLANGE']]);
  assert.equal(result.evidence.elements[0].api,'API_NOT_APPLICABLE_CONNECTION');
  assert.equal(result.evidence.elements[1].api,'API_ESTIMATE');
  const ciiButton=result.evidence.buttons.find(x=>x.action==='download-cii');
  assert.equal(ciiButton?.disabled,true);
  assert.deepEqual([
    result.evidence.repairEvidence.quarantinedStatus,
    result.evidence.repairEvidence.quarantinedSourceEqual,
    result.evidence.repairEvidence.releasedCiiStillBlank,
    result.evidence.repairEvidence.reviewButtonEnabled,
    result.evidence.repairEvidence.heldBannerPresent,
    result.evidence.repairEvidence.defaultFilter,
    result.evidence.repairEvidence.connectionShortSpan,
    result.evidence.repairEvidence.connectionAuditFlagged,
    result.evidence.repairEvidence.flangeAuditFlagged,
  ],[
    'QUARANTINED_REVIEW_ONLY',true,true,true,true,
    'REPAIR_CANDIDATES','true','true','false',
  ],'genuine service HOLD must open focused 19.1mm PCOM review but not release CII');
  assert.match(result.evidence.panelText,/Rigid Mass Ownership/u);
  assert.match(result.evidence.panelText,/RIGID_MASS_CONSERVATION_HOLD/u);
  assert.equal(result.heavy.ok,true);
  assert.equal(result.heavy.status,'SOURCE_PARITY_ONLY_NOT_MASS_AUTHORITY');
  assert.equal(result.heavy.qualified,false);
  assert.equal(result.heavy.weight,1100);
  assert.equal(result.heavy.ciiAvailable,true);
  assert.equal(result.heavy.ciiMatches,true);
  assert.equal(result.topoFix.ok,true);
  assert.equal(result.topoFix.ciiSame,true);
  assert.equal(result.topoFix.status,'SOURCE_PARITY_ONLY_NOT_MASS_AUTHORITY');
  assert.equal(result.topoFix.missingHeld,true);
  receipt.statements.push({id:'BROWSER_DOM',status:'PASS',meaning:'Real Chromium parses XML; 19.1mm owns PCOM and 109mm owns flange'});
  receipt.statements.push({id:'BROWSER_OUTPUT_RUN_SERVICE',status:'PASS',meaning:'CII withheld with duplicate mass; no manufactured allocation'});
  receipt.statements.push({id:'BROWSER_OUTPUT_RUN_UI',status:'PASS',meaning:'Held CII download disabled; diagnostics downloadable and HOLD visible'});
  receipt.statements.push({id:'BROWSER_HELD_RIGID_REPAIR',status:'PASS',meaning:'Real 19.1mm PCOM audit flag opens quarantined review; 109mm flange remains separate; no normal CII release'});
  receipt.statements.push({id:'HEAVY_SHORT_RIGID',status:'PASS',meaning:'Legitimate short heavy rigid not rejected by length alone; not engineering approved'});
  receipt.statements.push({id:'TOPOFIX_CUSTODY',status:'PASS',meaning:'Audits committed fixed XML, refuses missing TopoFix CII-input custody'});
  await page.screenshot({path:resolve(artifactDir,'output-run-held-cii.png'),fullPage:true});
  await writeFile(resolve(artifactDir,'receipt.json'),JSON.stringify({...receipt,evidence:result,consoleErrors:errors},null,2));
  console.log('XML-CII rigid mass Chromium checks PASS (real DOM, injected engine).');
} catch(error) {
  await writeFile(resolve(artifactDir,'receipt.json'),JSON.stringify({...receipt,
    failure:String(error),consoleErrors:errors},null,2));
  throw error;
} finally {await browser.close();}
