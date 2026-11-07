import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage();
try {
  await page.goto('http://127.0.0.1:4173/tests/fixtures/xml-cii-standalone/rigid-mass-browser-harness.html');
  const result=await page.evaluate(async()=>{
    const { collectXmlCiiZeroRigidWeightIssues, collectXmlCiiWeightMatchRows,
      xmlCiiWeightReviewCategory } = await import('/converters/xml-cii2019-core/weight-match-model.js');
    function n(num,ep,type,ref,z){
      return '<Node><NodeNumber>'+num+'</NodeNumber><Endpoint>'+ep+
        '</Endpoint><ComponentType>'+type+'</ComponentType><ComponentRefNo>'+ref+
        '</ComponentRefNo><Position>0 0 '+z+'</Position><Weight>0</Weight>'+
        '<BoreMm>50</BoreMm><Rating>900</Rating></Node>';
    }
    const xml='<PipeStressExport><Pipe><Branch><Branchname>GLRD/B1</Branchname>'+
      n(1119,2,'VALV','=134234934/28060',0)+
      n(-1,1,'PCOM','=134234934/28062',3.2)+
      n(-1,2,'PCOM','=134234934/28062',15.9)+
      n(10020,1,'FLAN','=134234934/28064',19.1)+
      n(1120,2,'RIGID','=134234934/28064',128.1)+
      '</Branch></Pipe></PipeStressExport>';
    const config={weight:{masterRows:[]},overrides:{rigidWeight:{}},
      splitCondensedValveFlange:true};
    const unresolved=collectXmlCiiZeroRigidWeightIssues(xml,'{}',config);
    const full=collectXmlCiiWeightMatchRows(xml,'{}',config);
    const pcom=unresolved.filter(x=>x.componentType==='PCOM');
    const flange=unresolved.filter(x=>x.componentType==='FLAN');
    return {
      pcom,flange,fullCount:full.length,unresolvedCount:unresolved.length,
      category:xmlCiiWeightReviewCategory('PCOM'),
      preservedXml:xml.includes('<ComponentType>PCOM</ComponentType>')
    };
  });
  assert.equal(result.category,'UNKNOWN');
  assert.equal(result.pcom.length,1,'one PCOM source component, endpoint 2 only');
  const row=result.pcom[0];
  assert.equal(row.reviewCategory,'UNKNOWN');
  assert.equal(row.componentType,'PCOM','preserve original identity');
  assert.equal(row.componentRefNo,'=134234934/28062');
  assert.equal(row.endpoint,'2');
  assert.equal(row.elementLengthSource,'component-ref-endpoint-span');
  assert.ok(Math.abs(row.lengthMm-12.7)<0.001,
    'physical PCOM length is 12.7 mm, not 19.1 mm route edge');
  assert.equal(row.weight,0);
  assert.equal(row.mapped,false);
  assert.equal(result.flange.length,0, 'flange endpoint 1 is not a review endpoint; its endpoint 2 is RIGID');
  assert.ok(result.preservedXml);
  console.log('PCOM->UNKNOWN review routing PASS: 12.7mm source span, 0 mass, intact reference');
}finally{await browser.close();}
