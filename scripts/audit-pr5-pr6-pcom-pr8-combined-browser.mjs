import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage();
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto('http://127.0.0.1:4173/tests/fixtures/xml-cii-standalone/rigid-mass-browser-harness.html');
  const result=await page.evaluate(async()=>{
    const {collectXmlCiiZeroRigidWeightIssues,applyXmlCiiRigidWeightOverrides}=
      await import('/converters/xml-cii2019-core/weight-match-model.js');
    const {applyXmlCiiFlangeWeightFallbackToIssue}=
      await import('/converters/xml-cii2019-core/flange-weight-fallback.js');
    const {collectXmlCiiAutoRigidWeightsFromIssues}=
      await import('/converters/xml-cii2019-core/rigid-weight-auto-apply.js');
    const {sourceFactsIndex,standaloneWeightIssueFromDryRunNode}=
      await import('/tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-weight-match.js');
    const {isApprovedPhysicalMassCandidate}=
      await import('/converters/xml-cii2019-core/physical-mass-approval.js');
    const rows=[
      {bore:50,rating:900,length:109,weight:15,valveType:'Flg',
        _raw:{TypeDesc:'Weldneck Flange',DN:50,Rating:900,'RF-F/F':109,'RF/RTJ KG':15}},
      {bore:50,rating:900,length:368,weight:47,valveType:'VLV3',
        _raw:{TypeDesc:'Flanged Ball Valve-Reduced Bore',DN:50,Rating:900,
          'RF-F/F':368,'RF/RTJ KG':47}},
    ];
    const config={weight:{masterRows:rows},overrides:{rigidWeight:{}},
      splitCondensedValveFlange:true};
    const n=(number,endpoint,type,ref,z,rigid='')=>
      '<Node><NodeNumber>'+number+'</NodeNumber><Endpoint>'+endpoint+
      '</Endpoint><ComponentType>'+type+'</ComponentType>'+
      '<ComponentRefNo>'+ref+'</ComponentRefNo><Position>0 0 '+z+'</Position>'+
      '<OutsideDiameter>60.3</OutsideDiameter><BoreMm>50</BoreMm>'+
      '<Rating>900</Rating><Weight>0</Weight><Rigid>'+rigid+'</Rigid></Node>';
    const outputs=[];
    for(const span of [12.7,115,115.001,371.2]){
      const xml='<PipeStressExport><Pipe><Branch><Branchname>LINE/B1</Branchname>'+
        n(1119,2,'VALV','=V',0)+
        n(-1,1,'PCOM','=P',3.2)+n(-1,2,'PCOM','=P',3.2+span)+
        n(10020,1,'FLAN','=F',3.2+span+3.2,'2')+
        n(1120,2,'RIGID','=F',112.2+span,'2')+
        '</Branch></Pipe></PipeStressExport>';
      const issues=collectXmlCiiZeroRigidWeightIssues(xml,'{}',config);
      const matched=issues.filter(i=>i.componentType==='PCOM');
      const issue=matched[0];
      const proposed=issue?applyXmlCiiFlangeWeightFallbackToIssue(issue,config):null;
      const manualFree=applyXmlCiiRigidWeightOverrides(xml,{});
      const fictionalRow={key:'LINE/B1::PCOM',branchName:'LINE/B1',
        nodeNumber:'-1',endpoint:'2',componentType:'PCOM',componentRefNo:'=P',
        lengthMm:span+100,weightMatch:{weight:99,selectedWeight:99,preferred:true,
          massAuthority:'ESTIMATE_ONLY_NOT_APPROVED_COMPONENT_MASS'}};
      const standalone=standaloneWeightIssueFromDryRunNode(fictionalRow,config,sourceFactsIndex(xml));
      outputs.push({
        span,count:matched.length,
        reviewCategory:issue?.reviewCategory,componentType:issue?.componentType,
        lengthSource:issue?.elementLengthSource,length:issue?.lengthMm,
        ref:issue?.componentRefNo,
        advisoryKg:proposed?.unknownComponentSuggestion?.suggestedKg,
        family:proposed?.unknownComponentSuggestion?.referenceFamily,
        approved:proposed?.unknownComponentSuggestion?.engineeringMassApproved,
        acceptedForCii:proposed?.unknownComponentSuggestion?.acceptedForCii,
        candidates:proposed?.candidates?.length,
        autoApplied:collectXmlCiiAutoRigidWeightsFromIssues([proposed]).appliedCount,
        serializedUnchanged:manualFree.appliedCount===0&&manualFree.xmlText.includes('<Weight>0</Weight>'),
        standaloneMapped:standalone.mapped,
        standaloneSourceLength:standalone.lengthMm,
        standaloneSource:standalone.elementLengthSource,
        sourcePcomRetained:xml.includes('<ComponentType>PCOM</ComponentType>'),
        inferredApproved:isApprovedPhysicalMassCandidate(proposed?.ranking?.best),
      });
    }
    return outputs;
  });
  for(const x of result) {
    assert.equal(x.count,1);
    assert.equal(x.reviewCategory,'UNKNOWN');
    assert.equal(x.componentType,'PCOM');
    assert.equal(x.ref,'=P');
    assert.equal(x.lengthSource,'component-ref-endpoint-span');
    assert.ok(Math.abs(x.length-x.span)<1e-7);
    assert.equal(x.approved,false);
    assert.equal(x.acceptedForCii,false);
    assert.equal(x.autoApplied,0);
    assert.equal(x.serializedUnchanged,true);
    assert.equal(x.standaloneMapped,false);
    assert.ok(Math.abs(x.standaloneSourceLength-x.span)<1e-7);
    assert.equal(x.standaloneSource,'component-ref-endpoint-span');
    assert.equal(x.sourcePcomRetained,true);
    assert.equal(x.inferredApproved,false);
  }
  assert.equal(result[1].family,'Weldneck Flange');
  assert.equal(result[1].advisoryKg,15);
  assert.equal(result[2].family,'Flanged Ball Valve-Reduced Bore');
  assert.equal(result[2].advisoryKg,14.688);
  assert.equal(result[3].advisoryKg,47.409);
  assert.deepEqual(errors,[]);
  console.log('Combined PR5/PR6/PR8 PCOM->Unknown browser pass',JSON.stringify(result));
}finally{await browser.close();}
