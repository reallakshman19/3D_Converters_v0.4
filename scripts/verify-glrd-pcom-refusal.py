#!/usr/bin/env python3
"""Adversarial PCOM explicit owner tests against actual GLRD browser-enriched XML."""
import copy,json,sys,tempfile,xml.etree.ElementTree as ET
from dataclasses import replace
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'converters/scripts'))
import xml_to_cii2019 as base
import xml_to_cii2019_patched as patched
from xml_to_cii2019_pcom_mass import (
    source_explicit_pcom_components,allocate_explicit_pcom_to_rigid
)
out=ROOT/'artifacts/glrd-pcom'
xml=out/'browser-parity-explicit-pcom.xml'
configs=json.loads((out/'browser-parity-explicit-configs.json').read_text())
config=configs['one']
key=next(iter(config['overrides']['rigidWeight']))
ref='=134234934/28062'
failures=[]
def refuse(label,action,code):
    try:action()
    except ValueError as err:
        if code not in str(err):raise AssertionError(f'{label}: wrong refusal {err}') from err
        failures.append(dict(case=label,refusal=code))
        return
    raise AssertionError(label+' unexpectedly accepted')

def rewritten(modifier):
    root=ET.parse(xml).getroot()
    modifier(root)
    with tempfile.NamedTemporaryFile(suffix='.xml',delete=False) as f:
        p=Path(f.name)
    ET.ElementTree(root).write(p,encoding='utf-8',xml_declaration=True)
    return p

def pick(root,endpoint):
    return next(n for n in root.iter()
        if n.tag.rsplit('}',1)[-1]=='Node'
        and next((str(c.text or '').strip() for c in n if c.tag.rsplit('}',1)[-1]=='ComponentRefNo'),'')==ref
        and next((str(c.text or '').strip() for c in n if c.tag.rsplit('}',1)[-1]=='Endpoint'),'')==endpoint)

def set_weight(root,endpoint,value):
    n=pick(root,endpoint)
    for c in n:
        if c.tag.rsplit('}',1)[-1]=='Weight':
            c.text=str(value);return
    raise AssertionError('missing Weight')

def drop_endpoint(root):
    n=pick(root,'1')
    for parent in root.iter():
        if n in list(parent):parent.remove(n);return

def duplicate_endpoint(root):
    n=pick(root,'2')
    for parent in root.iter():
        if n in list(parent):parent.append(copy.deepcopy(n));return

source=source_explicit_pcom_components(xml,config)
assert len(source)==1 and source[0]['ref']=='134234934/28062'
assert source_explicit_pcom_components(xml,{})==[]
wrong=copy.deepcopy(config);wrong['overrides']['rigidWeight'][key]=1.749
refuse('stale-source-mass',lambda:source_explicit_pcom_components(xml,wrong),
       'CII_PCOM_SAVED_MASS_NOT_IN_ENGINE_INPUT')
bad=copy.deepcopy(config);bad['overrides']['rigidWeight']={key.replace('|2|','|1|'):1.748}
refuse('wrong-endpoint-override',lambda:source_explicit_pcom_components(xml,bad),
       'CII_PCOM_SAVED_OWNER_NOT_FOUND')
zero=copy.deepcopy(config);zero['overrides']['rigidWeight'][key]=0
refuse('zero-mass-override',lambda:source_explicit_pcom_components(xml,zero),
       'CII_PCOM_EXPLICIT_OVERRIDE_INVALID')
for name,change,code in [
 ('positive-endpoint1',lambda root:set_weight(root,'1',1.748),'CII_PCOM_ENDPOINT1_MASS_CONFLICT'),
 ('missing-endpoint1',drop_endpoint,'CII_PCOM_SOURCE_PAIR_AMBIGUOUS'),
 ('duplicate-endpoint2',duplicate_endpoint,'CII_PCOM_SOURCE_PAIR_AMBIGUOUS')
]:
    temp=rewritten(change)
    try:refuse(name,lambda p=temp:source_explicit_pcom_components(p,config),code)
    finally:temp.unlink(missing_ok=True)

# Wrong geometry: raw native route is >600mm mixed valve/flange, not the
# browser-enriched 19.1mm connection. A 12.7mm PCOM cannot own that route.
raw=Path('/tmp/glrd-pcom/GLRD-1000-PI-01 - BM2.xml')
raw_document=base._parse_xml_document(raw)
raw_model=patched._build_conversion_model(raw_document,{},None,{})
refuse('long-mixed-raw-route',lambda:allocate_explicit_pcom_to_rigid(raw_model,source),
       'CII_PCOM_RIGID_OWNER_AMBIGUOUS')

# Even a unique overlap must not replace an already weighted flange-entry
# pointer. The legacy owner conflict stays authoritative.
model=patched._build_conversion_model(base._parse_xml_document(xml),{},None,{})
new_edges=list(model.edges)
ix=next(i for i,e in enumerate(new_edges) if e.from_node.node_number==1119 and e.to_node.node_number==10020)
old=new_edges[ix]
replacement=replace(old,to_node=replace(old.to_node,weight=15.))
new_edges[ix]=replacement
new_rigids=[replacement if e is old else e for e in model.rigid_edges]
conflicting=replace(model,edges=new_edges,rigid_edges=new_rigids)
refuse('preweighted-flange-entry',lambda:allocate_explicit_pcom_to_rigid(conflicting,source),
       'CII_PCOM_EXISTING_OWNER_CONFLICT')

# Simulate duplicate physical refs to the same emitted pointer; each pointer
# must have ONE owner, not two accepted source components.
clone={**source[0], 'ref':'134234934/DUPLICATE'}
refuse('two-pcoms-one-rigid-pointer',lambda:allocate_explicit_pcom_to_rigid(model,source+[clone]),
       'CII_PCOM_RIGID_POINTER_REUSED')
assert len(failures)==8,failures
(out/'pcom-refusal-receipt.json').write_text(json.dumps(dict(schema='PCOM_REFUSAL_V1',
   refusedCount=len(failures),cases=failures),indent=2))
print('GLRD_PCOM_8_FAIL_CLOSED_MUTANTS_PASS',json.dumps(failures))
