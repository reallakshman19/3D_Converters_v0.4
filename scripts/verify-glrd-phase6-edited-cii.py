#!/usr/bin/env python3
"""GLRD actual Phase 6 saved mass edit -> *native emitted CII* RIGID-pointer audit.

Mechanical evidence only. The 109 reviewed masses were SIMULATED UI attestations;
this test never treats catalog or matching score as physical engineering approval.
"""
from __future__ import annotations
import hashlib
import json
import math
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/"artifacts/glrd-phase6-parity"
NATIVE=ROOT/"converters/scripts/xml_to_cii2019_runtime_custody.py"
BEFORE=ART/"phase6-ui-reextracted-enriched.xml"
AFTER=ART/"phase6-ui-edited-mass-enriched.xml"
CONFIG_BEFORE=ART/"phase6-ui-reviewed-config.json"
CONFIG_AFTER=ART/"phase6-ui-edited-mass-config.json"
EDIT_RECEIPT=ART/"phase6-mapped-edit-undo-receipt.json"
for f in (BEFORE,AFTER,CONFIG_BEFORE,CONFIG_AFTER,EDIT_RECEIPT):
    assert f.is_file(),f"Required actual Phase 6 browser artifact missing: {f}"
before_cfg=json.loads(CONFIG_BEFORE.read_text())
after_cfg=json.loads(CONFIG_AFTER.read_text())
edit=json.loads(EDIT_RECEIPT.read_text())
key=edit["key"]
old=float(edit["originalMass"])
new=float(edit["changedMass"])
assert math.isclose(new-old,2.0,abs_tol=1e-8),(key,old,new)
assert math.isclose(float(before_cfg["overrides"]["rigidWeight"][key]),old,abs_tol=1e-8)
assert math.isclose(float(after_cfg["overrides"]["rigidWeight"][key]),new,abs_tol=1e-8)
assert len(before_cfg["overrides"]["rigidWeight"])==109
assert len(after_cfg["overrides"]["rigidWeight"])==109
assert len(before_cfg["overrides"]["rigidWeightSkipped"])==5
assert len(after_cfg["overrides"]["rigidWeightSkipped"])==5
assert key in before_cfg["overrides"]["rigidWeightReviewReceipts"]
assert key not in after_cfg["overrides"]["rigidWeightReviewReceipts"]
assert {k:v for k,v in before_cfg["overrides"]["rigidWeight"].items() if k!=key} == {
    k:v for k,v in after_cfg["overrides"]["rigidWeight"].items() if k!=key}
assert not set(after_cfg["overrides"]["rigidWeightSkipped"]) & set(
    after_cfg["overrides"]["rigidWeight"])


def convert(tag, xml_path,config):
    output=ART/("phase6-"+tag+".cii")
    # The browser output already carries source mass. The saved override map
    # is also supplied to the native writer for explicit PCOM endpoint custody.
    native_config={"overrides":{"rigidWeight":config["overrides"]["rigidWeight"]}}
    cmd=[sys.executable,str(NATIVE),"--input",str(xml_path),
         "--output",str(output),"--weight-scale","10","--coords-mode","first",
         "--split-condensed-valve-flange",
         "--support-config-json",json.dumps(native_config,separators=(",",":"))]
    result=subprocess.run(cmd,cwd=ROOT,capture_output=True,text=True,timeout=210)
    if result.returncode or not output.is_file():
        (ART/("phase6-"+tag+"-native-error.log")).write_text(result.stderr[-14000:])
        raise RuntimeError(f"Native CII conversion {tag} failed: {result.stderr[-4000:]}")
    return output, result.stderr


def sections(path):
    result={}
    current=None
    for line in path.read_text().splitlines():
        if line.startswith("#$ "):
            current=line[3:].strip()
            if current in result:raise AssertionError(f"Duplicate CII section {current}")
            result[current]=[]
        elif current is not None:
            result[current].append(line)
    return result


def parse(blocks):
    control=blocks["CONTROL"]
    element_count=int(control[0].split()[0])
    rigid_count=int(control[1].split()[1])
    elements=blocks["ELEMENTS"]
    masses=[float(row.split()[0]) for row in blocks["RIGID"]]
    assert len(masses)==rigid_count,(len(masses),rigid_count)
    assert len(elements)==element_count*15,(len(elements),element_count)
    routed=[]
    for i in range(element_count):
        row=elements[i*15:(i+1)*15]
        position=re.findall(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?",row[0])
        pointer=int(row[12].split()[1])
        assert 0<=pointer<=rigid_count
        routed.append({
            "element":i+1,"from":int(float(position[0])),
            "to":int(float(position[1])),"rigidPointer":pointer,
            "massForceN":masses[pointer-1] if pointer else 0,
        })
    return masses,routed


def weight_changes():
    left,right=ET.fromstring(BEFORE.read_bytes()),ET.fromstring(AFTER.read_bytes())
    changed=[]
    def namespace(root):
        return root.tag.partition("}")[0]+"}" if root.tag.startswith("{") else ""
    ns=namespace(left)
    assert ns==namespace(right),"Input and edited XML namespaces differ"
    def nodes(root):
        result=[]
        for branch in root.iter(ns+"Branch"):
            name=branch.findtext(ns+"Branchname") or ""
            for i,node in enumerate(branch.iter(ns+"Node")):
                result.append((name,i,node))
        return result
    l,r=nodes(left),nodes(right)
    assert len(l)==len(r)==994,(len(l),len(r))
    for (lb,li,ln),(rb,ri,rn) in zip(l,r):
        assert (lb,li)==(rb,ri)
        before_weight=float(ln.findtext(ns+"Weight") or "0")
        after_weight=float(rn.findtext(ns+"Weight") or "0")
        if not math.isclose(before_weight,after_weight,rel_tol=0,abs_tol=1e-8):
            changed.append({
                "branch":lb,"nodeIndex":li,
                "nodeNumber":ln.findtext(ns+"NodeNumber") or ln.findtext(ns+"Number") or "",
                "beforeKg":before_weight,"afterKg":after_weight,
            })
    assert len(changed)==1,changed
    assert math.isclose(changed[0]["afterKg"]-changed[0]["beforeKg"],2.0,abs_tol=1e-8),changed
    return changed[0]


source_delta=weight_changes()
before_path,before_log=convert("reviewed-unchanged",BEFORE,before_cfg)
after_path,after_log=convert("reviewed-mass-edited",AFTER,after_cfg)
before_blocks,after_blocks=sections(before_path),sections(after_path)
assert list(before_blocks)==list(after_blocks)
nonrigid_changed=[name for name in before_blocks if name!="RIGID"
                  and before_blocks[name]!=after_blocks[name]]
assert not nonrigid_changed,nonrigid_changed
before_masses,before_elements=parse(before_blocks)
after_masses,after_elements=parse(after_blocks)
assert len(before_masses)==len(after_masses)==144
assert len(before_elements)==len(after_elements)==433
assert [(e["from"],e["to"],e["rigidPointer"]) for e in before_elements] == [
    (e["from"],e["to"],e["rigidPointer"]) for e in after_elements]
deltas={
    index+1:(a,b) for index,(a,b) in enumerate(zip(before_masses,after_masses))
    if not math.isclose(a,b,rel_tol=0,abs_tol=1e-7)
}
assert len(deltas)==1,("Unexpected changed RIGID pointers",deltas)
pointer,(a,b)=next(iter(deltas.items()))
assert math.isclose(b-a,20.0,rel_tol=0,abs_tol=1e-6),(pointer,a,b)
owners=[element for element in after_elements if element["rigidPointer"]==pointer]
assert owners,("No emitted ELEMENTS row owns changed RIGID pointer",pointer)
assert len({e["rigidPointer"] for e in owners})==1
assert all(math.isclose(e["massForceN"],b,abs_tol=1e-7) for e in owners)
assert sum(1 for x in before_masses if x>0)==sum(1 for x in after_masses if x>0)

receipt={
    "schema":"PHASE6-GLRD-EDITED-MASS-TO-EMITTED-CII-RIGID-R1",
    "engineeringMassApproval":False,
    "simulatedInitialOwnerReview":True,
    "explicitManualEdit":key,
    "sourceNodeDelta":source_delta,
    "originalKg":old,"editedKg":new,
    "conversionKgToN":10,
    "expectedForceDeltaN":20.0,
    "ciiElementCount":len(after_elements),
    "ciiRigidPointerCount":len(after_masses),
    "changedRigidPointer":pointer,
    "rigidMassBeforeN":a,"rigidMassAfterN":b,
    "changedPointerOwners":owners,
    "changedCiiRigidCount":len(deltas),
    "unchangedAllNonRigidSections":True,
    "unchangedElementNodeTopologyAndPointers":True,
    "staleReceiptReused":False,
    "ciiBaselineSha256":hashlib.sha256(before_path.read_bytes()).hexdigest(),
    "ciiEditedSha256":hashlib.sha256(after_path.read_bytes()).hexdigest(),
}
(ART/"phase6-edited-cii-rigid-pointer-receipt.json").write_text(json.dumps(receipt,indent=2))
print("PHASE6_GLRD_EDITED_CII_POINTER_PASS",json.dumps({
  field:receipt[field] for field in
  ("explicitManualEdit","changedRigidPointer","changedCiiRigidCount",
   "expectedForceDeltaN","ciiElementCount","ciiRigidPointerCount",
   "unchangedAllNonRigidSections","unchangedElementNodeTopologyAndPointers")
}))
