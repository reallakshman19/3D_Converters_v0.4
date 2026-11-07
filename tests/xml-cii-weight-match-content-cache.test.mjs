import test from 'node:test';
import assert from 'node:assert/strict';
import {wmCacheFingerprint, sourceFactsIndex} from '../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-weight-match.js';

const originalXml = '<PipeStressExport><Pipe><Branch><Branchname>B1</Branchname><Node><NodeNumber>10020</NodeNumber><ComponentRefNo>=F13</ComponentRefNo><Endpoint>2</Endpoint><Weight>0</Weight><Position>0 0 115</Position></Node></Branch></Pipe></PipeStressExport>';
const modifiedXml = originalXml.replace('<Weight>0</Weight>','<Weight>1</Weight>');
const config = {weight:{masterRows:[{TypeDesc:'Weldneck Flange',DN:50,Rating:900,'RF/RTJ KG':15, 'RF-F/F':109}]},overrides:{rigidWeight:{}}};
const fp = (xml=originalXml, staged='{}', cfg=config, split=true)=>wmCacheFingerprint(xml, staged, cfg, split);

test('cache key changes for equal-length XML with different original physical mass',async()=>{
  assert.equal(originalXml.length,modifiedXml.length);
  const a=await fp();
  const b=await fp(modifiedXml);
  assert.equal(typeof a,'string');
  assert.equal(a.length,64);
  assert.notEqual(a,b,'must never restore old mapped state for a same-size source edit');
  assert.equal(a,await fp(),'repeat inputs must be deterministic');
});
test('cache key binds staged JSON, actual master values, approval overrides, and splitting',async()=>{
  const base=await fp();
  assert.notEqual(base,await fp(originalXml,'{"a":1}'));
  const changed=structuredClone(config);
  changed.weight.masterRows[0]['RF/RTJ KG']=16;
  assert.equal(JSON.stringify(config).length,JSON.stringify(changed).length,
    'master mass changes can preserve config length');
  assert.notEqual(base,await fp(originalXml,'{}',changed));
  const overridden=structuredClone(config);
  overridden.overrides.rigidWeight['B1::10020']=15;
  assert.notEqual(base,await fp(originalXml,'{}',overridden));
  assert.notEqual(base,await fp(originalXml,'{}',config,false));
});
test('source facts parser remains available for source-authority reconstruction',()=>{
  assert.equal(typeof sourceFactsIndex,'function');
});
