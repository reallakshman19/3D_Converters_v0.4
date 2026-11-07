import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

const base=process.env.EMPIRICAL_BROWSER_BASE_URL||'http://127.0.0.1:4173';
const dir=resolve(process.env.EMPIRICAL_BROWSER_ARTIFACT_DIR||'artifacts/empirical-nearest-browser');
await mkdir(dir,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}});
const pageErrors=[];
page.on('pageerror',e=>pageErrors.push(String(e?.message||e)));
const receipt={schema:'empirical-nearest-browser/v1',browser:'CHROMIUM',
  tests:[],limits:['NO XML->CII MASS ALLOCATION','NO PCOM MODEL','NO PRODUCTION MODEL PROMOTION']};

function selectedRow(label){
  return page.locator('table.engineering-master-table tbody tr')
    .filter({has:page.locator('td:first-child',{hasText:label})}).first();
}
async function readWeightRow(label){
  const row=selectedRow(label);
  await row.waitFor({state:'visible'});
  return row.locator('td').allTextContents();
}
try{
  await page.goto(base+'/tests/fixtures/empirical-weight-nearest-browser.html',
    {waitUntil:'domcontentloaded'});
  await page.evaluate(async()=>{
    const {renderEmpiricalWeightTuningTab}=await import('/tabs/empirical-weight-tuning-tab.js');
    renderEmpiricalWeightTuningTab(document.getElementById('app'),{context:{
      typeDesc:'SPECTACLE BLIND',target:'RF/RTJ KG',rating:300,ns:4
    }});
  });
  await page.locator('[data-view="sandbox"]').click();
  assert.equal((await readWeightRow('Exact master cell'))[1].trim(),'4.000');
  assert.equal((await readWeightRow('Final API estimate · current production'))[1].trim(),'4.000');
  assert.equal(await page.locator('[data-sandbox="custom-ns"]').inputValue(),'4');
  receipt.tests.push({name:'Class 300 spectacle blind NS4 exact 4kg',result:'PASS'});

  await page.locator('[data-sandbox="custom-ns"]').fill('5');
  await page.locator('[data-sandbox="custom-ns"]').press('Tab');
  assert.equal(await page.locator('[data-sandbox="custom-ns"]').inputValue(),'5');
  const nearest=await readWeightRow('Nearest master bracket · same family/rating');
  assert.equal(nearest[1].trim(),'6.500');
  assert.equal(nearest[2].trim(),'6.500');
  assert.match(nearest[4],/NEAREST_INTERPOLATED.*INTERPOLATED/u);
  assert.equal((await readWeightRow('Exact master cell'))[1].trim(),'—');
  const final=await readWeightRow('Final API · nearest-first (review only)');
  assert.equal(final[1].trim(),'6.500');
  assert.equal(final[2].trim(),'6.500');
  const raw=await page.locator('#app').innerText();
  assert.match(raw,/NS 4 \(4\.000 kg\) to NS 6 \(9\.000 kg\)/u);
  assert.match(raw,/fraction 0\.500/u);
  assert.match(raw,/Current production final routing is unchanged/u);
  assert.match(await page.locator('[data-sandbox="ns"]').inputValue(),/custom/u);
  receipt.tests.push({name:'Manual NS5 -> nearest bracket 4in/6in -> 6.5kg and provenance',result:'PASS'});

  await page.screenshot({path:resolve(dir,'sandbox-interpolated-ns5.png'),fullPage:true});
  assert.match(await page.locator('[data-unknown="result"]').innerText(),
    /2\.628 kg.*Weldneck Flange/u);
  assert.match(await page.locator('[data-unknown="basis"]').innerText(),
    /Flange reference 109 mm; threshold 115 mm/u);
  receipt.tests.push({name:'Unknown 19.1mm at DN50 Class900 gets advisory flange-based 2.628kg',result:'PASS'});
  await page.screenshot({path:resolve(dir,'unknown-component-short-flange-suggestion.png'),fullPage:true});

  await page.locator('[data-unknown="length"]').fill('371.2');
  await page.locator('[data-unknown="length"]').press('Tab');
  assert.match(await page.locator('[data-unknown="result"]').innerText(),
    /47\.409 kg.*Flanged Ball Valve-Reduced Bore/u);
  assert.match(await page.locator('[data-unknown="basis"]').innerText(),
    /Selected reference 368 mm \/ 47 kg/u);
  receipt.tests.push({name:'Unknown 371.2mm at DN50 Class900 gets reduced-bore ball valve 47.409kg',result:'PASS'});
  await page.screenshot({path:resolve(dir,'unknown-component-long-valve-suggestion.png'),fullPage:true});

  await page.locator('[data-unknown="length"]').fill('115');
  await page.locator('[data-unknown="length"]').press('Tab');
  assert.match(await page.locator('[data-unknown="result"]').innerText(),
    /15\.000 kg.*Weldneck Flange/u);
  assert.match(await page.locator('[data-unknown="basis"]').innerText(),
    /Selected reference 109 mm \/ 15 kg/u);
  receipt.tests.push({name:'Exactly 109+6mm -> full 15kg Weldneck Flange unchanged (no interpolation)',result:'PASS'});
  await page.locator('[data-unknown="rating"]').fill('12345');
  await page.locator('[data-unknown="rating"]').press('Tab');
  assert.match(await page.locator('[data-unknown="result"]').innerText(),
    /HOLD.*FLANGE_REFERENCE_NOT_QUALIFIED/u);
  receipt.tests.push({name:'Missing class-specific reference refuses cross-rating substitution',result:'PASS'});

  await page.locator('[data-sandbox="ns"]').selectOption('6');
  assert.equal((await readWeightRow('Exact master cell'))[1].trim(),'9.000');
  receipt.tests.push({name:'Known NS6 exact remains 9kg after custom NS',result:'PASS'});
  assert.deepEqual(pageErrors,[],'browser must have no script exceptions');
  await writeFile(resolve(dir,'receipt.json'),JSON.stringify({...receipt,pageErrors},null,2));
  console.log('Empirical nearest-weight Chromium UI checks PASS');
}catch(error){
  await writeFile(resolve(dir,'receipt.json'),JSON.stringify({...receipt,error:String(error),pageErrors},null,2));
  throw error;
}finally{await browser.close();}
