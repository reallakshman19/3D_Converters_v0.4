#!/usr/bin/env python3
"""GLRD simulated bulk Owner review -> browser parity -> native CII output.

The browser script explicitly simulates review confirmation. This proves
mechanical propagation and pointer custody, NOT engineering correctness
or an Owner-approved physical mass catalog.
"""
from __future__ import annotations
import json
import math
import subprocess
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'artifacts/glrd-review-choices'
NATIVE=ROOT/'converters/scripts/xml_to_cii2019_runtime_custody.py'
ENGINE=ART/'glrd-109-reviewed-five-skipped-engine-input.xml'
CONFIG=ART/'glrd-109-reviewed-five-skipped-config.json'
BASE=ROOT/'artifacts/glrd-native-parity/after.cii'
AFTER=ART/'glrd-109-reviewed-five-skipped.cii'
assert ENGINE.is_file() and CONFIG.is_file() and BASE.is_file(),     'Missing exact GLRD browser review/parity artifacts'
config=json.loads(CONFIG.read_text())
weights=config['overrides']['rigidWeight']
skips=config['overrides']['rigidWeightSkipped']
receipts=config['overrides']['rigidWeightReviewReceipts']
assert len(weights)==109 and len(skips)==5 and len(receipts)==109
assert all(float(w)>0 for w in weights.values())
assert not set(skips)&set(weights), '0kg skips may not be approved mass overrides'
assert set(receipts)==set(weights), 'every simulated accepted mass needs exact source receipt'
assert all(r['reviewMethod']=='EXPLICIT_BULK_OWNER_ATTESTATION' and
           r['reviewed'] is True and
           math.isclose(float(r['weightKg']),float(weights[k]),abs_tol=1e-8)
           for k,r in receipts.items())
cmd=[sys.executable,str(NATIVE),'--input',str(ENGINE),'--output',str(AFTER),
     '--weight-scale','10','--coords-mode','first',
     '--split-condensed-valve-flange',
     '--support-config-json',json.dumps(config,separators=(',',':'))]
r=subprocess.run(cmd,cwd=ROOT,capture_output=True,text=True,timeout=200)
if r.returncode!=0:
    (ART/'glrd-reviewed-native-failure.log').write_text(r.stderr[-12000:])
    raise RuntimeError('Native GLRD reviewed CII conversion failed: '+r.stderr[-3800:])
assert AFTER.is_file()
witnesses=[json.loads(line.partition('PCOM_EXPLICIT_CII_RIGID_OWNER ')[2])
  for line in r.stderr.splitlines() if line.startswith('PCOM_EXPLICIT_CII_RIGID_OWNER ')]
assert len(witnesses)==14,(len(witnesses),r.stderr[-5000:])
assert len({w['rigidPointer'] for w in witnesses})==14,'all 14 PCOM owners must have unique pointers'

def read_sections(path):
    result={}
    name=None
    for line in path.read_text().splitlines():
        if line.startswith('#$ '):
            name=line[3:].strip()
            assert name not in result,name
            result[name]=[]
        elif name is not None:
            result[name].append(line)
    return result

before=read_sections(BASE)
after=read_sections(AFTER)
assert before.keys()==after.keys()
for name in before:
    if name!='RIGID':
        assert before[name]==after[name],f'Unrelated native CII section mutated: {name}'
initial=before['RIGID']
published=after['RIGID']
assert len(initial)==len(published)==144,(len(initial),len(published))
before_mass=[float(x.split()[0]) for x in initial]
after_mass=[float(x.split()[0]) for x in published]
changed={i+1:(a,b) for i,(a,b) in enumerate(zip(before_mass,after_mass))
         if not math.isclose(a,b,rel_tol=0,abs_tol=1e-7)}
assert len(changed)==109,('109 accepted physical source owners must affect exactly 109 RIGID pointers',
                         len(changed),list(changed.items())[:12])
assert all(a==0 and b>0 for a,b in changed.values()),     'no existing positive RIGID mass may be overwritten by an empirical estimate'
assert all(w['rigidPointer'] in changed for w in witnesses),     'all 14 explicit PCOM source masses must reach actual emitted CII RIGID pointers'
assert sum(1 for m in after_mass if m<=0)==144-109,     'native RIGID census must retain zero masses for unreviewed/skipped components'
receipt={
  'schema':'GLRD-EXPLICIT-BULK-REVIEW-NATIVE-PARITY-R1',
  'mode':'SIMULATED_OWNER_ATTESTATION_TEST_ONLY',
  'engineeringMassApproved':False,
  'reviewedSourceMasses':len(weights),
  'zeroSkips':len(skips),
  'sourceReviewReceipts':len(receipts),
  'emittedRigidRecords':len(after_mass),
  'modifiedRigidPointers':len(changed),
  'nativePCOMOwnerPointers':len(witnesses),
  'nativePCOMWitnesses':witnesses,
  'otherCiiSectionsByteEqual':True,
  'overwrittenPreexistingMasses':0,
  'totalAddedForceN':round(sum(b-a for a,b in changed.values()),6),
}
(ART/'glrd-bulk-review-native-receipt.json').write_text(json.dumps(receipt,indent=2))
print('GLRD_BULK_REVIEW_NATIVE_POINTERS_PASS',json.dumps({
    key:receipt[key] for key in ('reviewedSourceMasses','zeroSkips',
      'sourceReviewReceipts','emittedRigidRecords','modifiedRigidPointers',
      'nativePCOMOwnerPointers','otherCiiSectionsByteEqual',
      'overwrittenPreexistingMasses','totalAddedForceN')}))
