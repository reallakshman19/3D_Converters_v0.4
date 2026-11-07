import { chromium } from 'playwright';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const folder='/tmp/glrd-pcom',out=resolve('artifacts/glrd-pcom');
await mkdir(out,{recursive:true});
const source=await readFile(folder+'/GLRD-1000-PI-01 - BM2.xml','utf8');
const stage=await readFile(folder+'/stage.json','utf8');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage(); await page.goto('http://127.0.0.1:4173/tests/fixtures/empirical-weight-nearest-browser.html');
 const data=await page.evaluate(async ({source,stage})=>{
  const {collectXmlCiiZeroRigidWeightIssues}=await import('/converters/xml-cii2019-core/weight-match-model.js');
  const {enrichStandaloneXmlForRun}=await import('/tabs/xml-cii-2019-standalone/xml-cii-standalone-run-parity.js');
  const config={};
  const issues=collectXmlCiiZeroRigidWeightIssues(source,stage,config).filter(x=>x.componentType==='PCOM');
  const row=issues.find(x=>x.componentRefNo.includes('/28062'));
  if(!row)throw Error('GLRD /28062 PCOM missing');
  const apply={...config,overrides:{rigidWeight:{[row.key]:1.748}}};
  const result=await enrichStandaloneXmlForRun({sourceText:source,stagedJsonText:stage,supportConfigJson:JSON.stringify(apply),options:{}});
  const doc=new DOMParser().parseFromString(result.xmlText||source,'application/xml');
  const rows=[...doc.getElementsByTagName('Node')].filter(n=>n.getElementsByTagName('ComponentRefNo')[0]?.textContent?.includes('/28062'))
    .map(n=>({number:n.getElementsByTagName('NodeNumber')[0]?.textContent,
      ref:n.getElementsByTagName('ComponentRefNo')[0]?.textContent,
      type:n.getElementsByTagName('ComponentType')[0]?.textContent,
      endpoint:n.getElementsByTagName('Endpoint')[0]?.textContent,
      weight:n.getElementsByTagName('Weight')[0]?.textContent,
      pos:n.getElementsByTagName('Position')[0]?.textContent}));
  return {ok:result.applied,error:result.error,logs:result.logs,stats:result.stats,
    key:row.key,originalIssue:row,rows,xml:result.xmlText||''};
 },{source,stage});
 await writeFile(out+'/browser-parity-diagnostic.json',JSON.stringify({...data,xml:undefined},null,2));
 if(data.xml)await writeFile(out+'/browser-parity-explicit-pcom.xml',data.xml);
 console.log('PCOM_BROWSER_PARITY',JSON.stringify({applied:data.ok,error:data.error,rows:data.rows,key:data.key,
   stats:data.stats,xmlBytes:data.xml.length,logs:data.logs?.slice(-3)}));
} finally{await browser.close()}
