#!/usr/bin/env python3
"""Independent CII ELEMENTS->pointer->RIGID verification of 14 GLRD saved PCOMs.

The input fixture explicitly simulates saved reviewer overrides; this test
does NOT authorize empirical weights in any production conversion.
"""
from __future__ import annotations
import json,hashlib,math,os,re,subprocess,sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts/glrd-pcom'
OUT.mkdir(parents=True,exist_ok=True)
ENGINE=ROOT/'converters/scripts/xml_to_cii2019_runtime_custody.py'
SOURCE=OUT/'browser-parity-explicit-pcom.xml'
ALL=OUT/'browser-parity-explicit-all14-pcom.xml'
configs=json.loads((OUT/'browser-parity-explicit-configs.json').read_text())

def run(kind,source,config):
    output=OUT/(kind+'.cii')
    cmd=[sys.executable,str(ENGINE),'--input',str(source),'--output',str(output),
         '--weight-scale','10','--coords-mode','first',
         '--split-condensed-valve-flange','--support-config-json',json.dumps(config)]
    run=subprocess.run(cmd,cwd=ROOT,capture_output=True,text=True,timeout=180)
    if run.returncode!=0:raise AssertionError(kind+' native conversion FAIL: '+run.stderr[-4500:])
    raw=output.read_text()
    witnesses=[json.loads(line.partition('PCOM_EXPLICIT_CII_RIGID_OWNER ')[2])
       for line in run.stderr.splitlines() if line.startswith('PCOM_EXPLICIT_CII_RIGID_OWNER ')]
    return raw,witnesses

def sections(raw):
    blocks={};section=None
    for line in raw.splitlines():
        if line.startswith('#$ '):
            section=line[3:].strip()
            if section in blocks:raise AssertionError('duplicate '+section)
            blocks[section]=[]
        elif section and line.strip():blocks[section].append(line)
    return blocks

def parsed(raw):
    blocks=sections(raw)
    control=blocks['CONTROL']
    n=int(control[0].split()[0])
    rigid_n=int(control[1].split()[1])
    elems=blocks['ELEMENTS']
    rigs=blocks['RIGID']
    assert len(elems)==n*15,(len(elems),n)
    assert len(rigs)==rigid_n,(len(rigs),rigid_n)
    values=[float(line.split()[0]) for line in rigs]
    elements=[]
    for i in range(n):
        b=elems[i*15:(i+1)*15]
        nums=re.findall(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?',b[0])
        ints=[int(x) for x in b[12].split()]
        pointer=ints[1]
        if pointer: assert 1<=pointer<=rigid_n
        elements.append(dict(index=i+1,fromNode=int(float(nums[0])),
            toNode=int(float(nums[1])),pointer=pointer,
            weightN=values[pointer-1] if pointer else 0))
    return blocks,values,elements

def assert_only_rigid_mass_differences(before,after,expected_count):
    bblock,bweights,belements=parsed(before)
    ablock,aweights,aelements=parsed(after)
    for sec in bblock:
        if sec!='RIGID':assert bblock[sec]==ablock[sec],('non-RIGID-output-changed',sec)
    assert len(bweights)==len(aweights)
    deltas={i+1:(b,a) for i,(b,a) in enumerate(zip(bweights,aweights)) if abs(a-b)>1e-9}
    assert len(deltas)==expected_count,('incorrect changed rigid pointers',deltas)
    assert len(belements)==len(aelements)
    for a,b in zip(belements,aelements):
        assert (a['fromNode'],a['toNode'],a['pointer'])==(b['fromNode'],b['toNode'],b['pointer'])
    return deltas,bblock,belements

no_one,_=run('no-pcom-review',SOURCE,{})
one,oneWitness=run('one-explicit-pcom-review',SOURCE,configs['one'])
oneDelta,baseBlock,baseElements=assert_only_rigid_mass_differences(no_one,one,1)
assert len(oneWitness)==1,oneWitness
assert oneWitness[0]['sourceRef'].endswith('/28062')
assert oneWitness[0]['sourcePhysicalSpanMm']==12.7
assert oneWitness[0]['elementLengthMm']==19.1
assert math.isclose(oneWitness[0]['ciiMassForceN'],17.48,abs_tol=1e-7)
assert oneWitness[0]['rigidPointer'] in oneDelta
assert oneDelta[oneWitness[0]['rigidPointer']][0]==0.0
assert math.isclose(oneDelta[oneWitness[0]['rigidPointer']][1],17.48,abs_tol=1e-8)

no_all,_=run('no-all-pcom-review',ALL,{})
all_run,allWitness=run('all14-explicit-pcom-review',ALL,configs['all'])
deltas,blocks,elements=assert_only_rigid_mass_differences(no_all,all_run,14)
assert len(allWitness)==14
assert len({w['sourceRef'] for w in allWitness})==14
assert len({w['rigidPointer'] for w in allWitness})==14
assert len({w['elementIndex'] for w in allWitness})==14
assert len(configs['all']['overrides']['rigidWeight'])==14
expected={w['rigidPointer'] for w in allWitness}
assert set(deltas)==expected,(set(deltas),expected)
for w in allWitness:
    assert abs(w['sourcePhysicalSpanMm']-12.7)<0.001,w
    assert abs(w['elementLengthMm']-19.1)<0.001,w
    assert abs(w['overlapMm']-12.7)<0.001,w
    assert math.isclose(w['massKg'],1.748,abs_tol=1e-9)
    assert math.isclose(w['ciiMassForceN'],17.48,abs_tol=1e-8)
    assert deltas[w['rigidPointer']][0]==0,('existing mass was replaced',w)
    assert math.isclose(deltas[w['rigidPointer']][1],17.48,abs_tol=1e-8)
    e=elements[w['elementIndex']-1]
    assert (e['fromNode'],e['toNode'],e['pointer'])==(w['fromNode'],w['toNode'],w['rigidPointer'])

receipt=dict(schema='GLRD-14-EXPLICIT-PCOM-RIGID-POINTER-EVIDENCE-R1',
    source='Owner GLRD BM2 exact input, processed through browser run parity',
    simulatedReviewerAcceptance=True,engineeringApproval=False,
    rawSourceWeightsUnchanged=True,
    one=oneWitness[0],fourteen=allWitness,allFourteenApplied=True,
    count=14,physicalComponentMm=12.7,emittedRouteMm=19.1,
    scaleKgToN=10,ciiElementCount=len(elements),ciiRigidRecordCount=len(blocks['RIGID']),
    distinctRigidPointers=len(expected),
    nonRigidSectionsByteEqual=True,
    noAdditionalMassDifferences=True,
    totalNewMassKg=14*1.748,totalNewMassN=14*17.48,
    baselineSha256=hashlib.sha256(no_all.encode()).hexdigest(),
    reviewedSha256=hashlib.sha256(all_run.encode()).hexdigest())
(OUT/'pcom-14-rigid-pointer-receipt.json').write_text(json.dumps(receipt,indent=2))
print('GLRD_PCOM_14_EXPLICIT_POINTERS_PASS',json.dumps({key:receipt[key] for key in
    ('count','ciiElementCount','ciiRigidRecordCount','distinctRigidPointers',
     'totalNewMassN','nonRigidSectionsByteEqual','noAdditionalMassDifferences')}))
