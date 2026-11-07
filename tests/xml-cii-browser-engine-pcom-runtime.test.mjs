import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root=resolve(new URL('..',import.meta.url).pathname);
const file=name=>readFileSync(resolve(root,name),'utf8');
const engine=file('converters/xml-cii-2019-standalone/engine.js');
const runtime=file('converters/scripts/xml_to_cii2019_runtime_custody.py');
const pcom=file('converters/scripts/xml_to_cii2019_pcom_mass.py');

test('Pyodide ships every local Python import of native CII runtime custody',()=>{
  const scripts=[...engine.matchAll(/^\s+'([a-zA-Z0-9_]+\.(?:py|json))',?$/gm)].map(m=>m[1]);
  assert.ok(scripts.includes('xml_to_cii2019_runtime_custody.py'));
  assert.ok(scripts.includes('xml_to_cii2019_pcom_mass.py'),
    'missing module would permit enriched XML, then fail CII writer with ModuleNotFoundError');
  for(const m of runtime.matchAll(/^(?:from|import)\s+([A-Za-z_]\w*)/gm)){
    const name=m[1];
    if(!name.startsWith('xml_to_cii2019') && !name.startsWith('cii2019_'))continue;
    assert.ok(scripts.includes(name+'.py'),name+' must be fetched into Pyodide /scripts/');
  }
  for(const name of scripts){
    assert.ok(existsSync(resolve(root,'converters/scripts',name)),name+' must exist in bundle');
  }
  assert.match(pcom,/source_explicit_pcom_components/);
  assert.match(pcom,/allocate_explicit_pcom_to_rigid/);
});

test('Skip blank records numeric zero custody without falsely approving mass',()=>{
  const state=file('tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a-state.js');
  assert.match(state,/rigidWeightSkipped/);
  assert.match(state,/weightKg:0/);
  assert.match(state,/EXPLICIT_ZERO_MASS_SKIP_NO_SOURCE_AUTHORITY/);
  assert.doesNotMatch(state,/rigidWeight\[key\]\s*=\s*0/);
});

test('no repeated per-row qualification controls in both exposed review UIs',()=>{
  const wm=file('tabs/model-converters/converters/xmltocii2019_helper/weight-match-renderer.js');
  const modeA=file('tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a.js');
  assert.doesNotMatch(wm,/data-wm-verified|data-wm-save-reviewed|Save reviewed/);
  assert.doesNotMatch(modeA,/data-rigid-suggestion-verified/);
  assert.match(wm,/mc-wm-batch-attest/);
  assert.match(wm,/mc-wm-batch-confirm/);
  assert.match(modeA,/data-mode-a-rigid-bulk-attest/);
  assert.match(modeA,/EXPLICIT_BULK_OWNER_ATTESTATION/);
});
