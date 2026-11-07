import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const root='artifacts/glrd-pcom';
const xml=await readFile(root+'/browser-parity-explicit-all14-pcom.xml','utf8');
const cii=await readFile(root+'/all14-explicit-pcom-review.cii','utf8');
const receipt=JSON.parse(await readFile(root+'/pcom-14-rigid-pointer-receipt.json','utf8'));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();
 await page.goto('http://127.0.0.1:4173/tests/fixtures/empirical-weight-nearest-browser.html');
 const result=await page.evaluate(async ({xml,cii,expected})=>{
    const {auditRigidWeightFromXml}=await import('/converters/xml-cii2019-core/rigid-weight-empirical-audit.js');
    const audit=auditRigidWeightFromXml({ciiText:cii,xmlText:xml,kgToNewtonScale:10});
    const selected=expected.map(w=>{
      const matches=audit.rows.filter(row=>row.rigidPointer===w.rigidPointer);
      const row=matches[0];
      return {ref:w.sourceRef,expectedPointer:w.rigidPointer,expectedElement:w.elementIndex,
        candidates:matches.length,actualRef:row?.physicalComponentRef||null,
        actualPointer:row?.rigidPointer??null,actualElement:row?.element??null,
        ownerType:row?.ownerType??null,weightN:row?.weightN??null,
        massKg:row?.sourceMassCandidateKg??null,flags:row?.flags??['NOT_FOUND'],
        ownership:row?.ownership??null};
    });
    return {auditStatus:audit.status,allFlags:audit.summary?.flagsByCode||{},
       elementCount:audit.elementCount,rigidCount:audit.rigidCount,selected};
 },{xml,cii,expected:receipt.fourteen});
 assert.equal(result.selected.length,14);
 for(const row of result.selected){
   assert.equal(row.candidates,1,'pointer must identify exactly one emitted RIGID element');
   assert.equal(String(row.actualRef).replace(/^=/,''),row.ref);
   assert.equal(row.actualPointer,row.expectedPointer);
   assert.equal(row.actualElement,row.expectedElement);
   assert.equal(row.ownerType,'PCOM');
   assert.equal(row.ownership,'GEOMETRIC_INTERIOR_OVERLAP');
   assert.ok(Math.abs(row.weightN-17.48)<1e-6);
   assert.ok(Math.abs(row.massKg-1.748)<1e-9);
   assert.deepEqual(row.flags,[],row.ref+' PR5 independent physical owner flags');
 }
 const report={schema:'GLRD-PCOM-PR5-INDEPENDENT-READONLY-AUDIT-R1',
   independentAuditSource:'rigid-weight-empirical-audit.js',
   all14PcomVerified:true,selected:result.selected,
   fullAuditStatus:result.auditStatus,fullAuditOtherFlags:result.allFlags,
   ciiElementCount:result.elementCount,ciiRigidCount:result.rigidCount,
   engineeringApproval:false};
 await writeFile(root+'/pcom-pr5-independent-audit.json',JSON.stringify(report,null,2));
 console.log('PCOM_PR5_INDEPENDENT_14_POINTERS_PASS',JSON.stringify({count:result.selected.length,
   pointerOwners:result.selected.map(x=>x.expectedPointer),
   otherAuditFlags:result.allFlags}));
}finally{await browser.close()}
