import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const base=process.env.EMPIRICAL_BROWSER_BASE_URL || 'http://127.0.0.1:4173';
const dir=resolve(process.env.EMPIRICAL_BROWSER_ARTIFACT_DIR || 'artifacts/empirical-unknown-browser');
await mkdir(dir,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:950}});
page.on('dialog',d=>d.accept());
const receipt={schema:'xml-cii-ir-r3-mode-a-easy-weight-browser/v1',cases:[],
  limitations:['synthetic source state, not GLRD native CII','exposed reviewer verdict remains NO-GO']};
async function setup({approval=false,second=false}={}){
  await page.evaluate(async ({approval,second})=>{
    const old=document.getElementById('ir-r3-panel');
    if(old)old.remove();
    const {DEFAULT_WEIGHT_MASTER_ROWS}=await import('/converters/xml-cii2019-core/default-weight-master-rows.js');
    const {rankXmlCiiWeightCandidates}=await import('/converters/xml-cii2019-core/weight-valve-hints.js');
    const {installModeAConsolidatedWeightEasyUi}=
      await import('/tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-mode-a-consolidated-easy-weight-ui.js');
    const {installModeAConsolidatedWeightTools}=
      await import('/tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-mode-a-weight-tools.js');
    const rank=rankXmlCiiWeightCandidates({
      boreMm:50,rating:900,lengthMm:109,componentType:'RIGID',dtxr:'WELDING NECK FLANGE SCH 40S 900#'
    },{weight:{masterRows:DEFAULT_WEIGHT_MASTER_ROWS}},{includeRejected:true});
    const original=rank.candidates.find(c=>/Weldneck Flange/i.test(String(c.typeDesc||c.valveType||c.type||'')));
    if(!original || Number(original.selectedWeight??original.suggestedWeight??original.weight)!==15)
      throw Error('Original 109mm/15kg Weldneck Flange master witness missing');
    const candidate=approval?{
      ...original,selectedWeight:15,suggestedWeight:15,weight:15,
      massAuthority:'APPROVED_SOURCE_MASS',engineeringMassApproved:true,
      acceptedForCii:true,preferred:true,weightMethod:'source-verified',
      inferredWeight:false,fallbackSuggestion:false,zeroFallback:false
    }:original;
    const makeRow=(sourceId,key)=>({
      sourceId,fileName:sourceId+'.xml',branchName:'B1',key,
      nodeNumber:'10020',componentRefNo:'=TEST/UNKNOWN',
      componentType:'RIGID',boreMm:50,rating:'900',lengthMm:109,
      bestWeight:15,bestScore:'100%',bestDescription:'Weldneck Flange',
      bestCandidate:candidate,mapped:false,dtxr:'Class 900',
    });
    const rows=[makeRow('SRC-A','B1::10020')];
    if(second)rows.push(makeRow('SRC-B','B1::20020'));
    const ref={current:{supportConfigJson:'{}',sourceBatch:{
      mode:'separate-models',activeSourceId:'SRC-A',sources:[
        {sourceId:'SRC-A',fileName:'SRC-A.xml',supportConfigJson:'{}'},
        {sourceId:'SRC-B',fileName:'SRC-B.xml',supportConfigJson:'{}'}
      ]
    }}};
    const panel=document.createElement('div');panel.id='ir-r3-panel';
    panel.innerHTML='<div><button data-mode-a-consolidated-build="weight">Rebuild</button></div>'+
      '<table><tbody data-mode-a-weight-consolidated-body></tbody></table>';
    const body=panel.querySelector('tbody');
    for(let i=0;i<rows.length;i++){
      const tr=document.createElement('tr');
      for(let j=0;j<16;j++){
        const td=document.createElement('td');
        td.textContent=j===12?'15 kg':'-';
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    document.body.appendChild(panel);
    const result={rows};
    installModeAConsolidatedWeightEasyUi(panel,result,ref);
    installModeAConsolidatedWeightTools(panel,result,ref);
    window.__irR3={panel,result,ref,original,candidate};
  },{approval,second});
}
async function saved(source='SRC-A',key='B1::10020'){
  return page.evaluate(({source,key})=>{
    const ref=window.__irR3.ref;
    const row=ref.current?.sourceBatch?.sources?.find(s=>s.sourceId===source);
    const config=JSON.parse(row?.supportConfigJson||'{}');
    return config?.overrides?.rigidWeight?.[key]??null;
  },{source,key});
}
try{
  await page.goto(base+'/tests/fixtures/empirical-weight-nearest-browser.html',
    {waitUntil:'domcontentloaded'});
  await setup();
  assert.equal(await page.getByRole('button',{name:'Use',exact:true}).count(),0,
    'single-row Use must be absent for 100% unapproved catalog match');
  assert.equal(await page.getByRole('button',{name:'↓'}).count(),0);
  await page.getByRole('button',{name:/Find Exact Weight Matches/}).click();
  assert.equal(await page.locator('[data-weight-project-apply]').count(),0,
    'no project Apply from 100% unapproved catalog match');
  await page.getByRole('button',{name:/Use all ★ preferred/}).click();
  assert.equal(await saved(),null,'unapproved normal preferred must write nothing');
  receipt.cases.push({type:'unapproved 109mm 100% master',routes:['single Use','similar',
    'project Apply','normal preferred'],persisted:0});
  await page.evaluate(()=>{
    const ctx=window.__irR3;
    ctx.result.rows[0]._modeAWeightDtxrBest={
      ...ctx.original,totalScore:1,preferred:true
    };
  });
  await page.getByRole('button',{name:/Use all ★ preferred/}).click();
  assert.equal(await saved(),null,'DTXR rerank cannot mint approval');
  receipt.cases.push({type:'unapproved DTXR preferred',persisted:0});
  await page.screenshot({path:resolve(dir,'r3-mode-a-unapproved-109mm-hold.png'),fullPage:true});

  await setup({approval:true});
  assert.equal(await page.getByRole('button',{name:'Use',exact:true}).count(),1);
  await page.getByRole('button',{name:'Use',exact:true}).click();
  assert.equal(await saved(),15);
  receipt.cases.push({type:'approved source single-row Use',persistedKg:15});

  await setup({approval:true});
  await page.getByRole('button',{name:/Find Exact Weight Matches/}).click();
  assert.equal(await page.locator('[data-weight-project-apply]').count(),1);
  await page.locator('[data-weight-project-apply]').click();
  assert.equal(await saved(),15);
  receipt.cases.push({type:'approved source project Apply',persistedKg:15});

  await setup({approval:true});
  await page.getByRole('button',{name:/Use all ★ preferred/}).click();
  assert.equal(await saved(),15);
  receipt.cases.push({type:'approved source normal preferred',persistedKg:15});

  await setup({approval:true});
  await page.evaluate(()=>{
    const ctx=window.__irR3;
    ctx.result.rows[0]._modeAWeightDtxrBest={
      ...ctx.candidate,totalScore:1,preferred:true
    };
  });
  await page.getByRole('button',{name:/Use all ★ preferred/}).click();
  assert.equal(await saved(),15);
  receipt.cases.push({type:'approved source DTXR preferred',persistedKg:15});

  await setup({approval:true,second:true});
  assert.equal(await page.getByRole('button',{name:'↓'}).count(),2);
  await page.getByRole('button',{name:'↓'}).first().click();
  assert.equal(await saved('SRC-A','B1::10020'),15);
  assert.equal(await saved('SRC-B','B1::20020'),15);
  receipt.cases.push({type:'approved source equivalent fill',sourceCount:2,persistedKg:15});

  await writeFile(resolve(dir,'r3-mode-a-receipt.json'),JSON.stringify(receipt,null,2));
  console.log('Stage-2 R3 Mode A real Chromium approval controls PASS:',receipt.cases.length);
}catch(error){
  await writeFile(resolve(dir,'r3-mode-a-receipt.json'),
    JSON.stringify({...receipt,error:String(error)},null,2));
  throw error;
}finally{await browser.close();}
