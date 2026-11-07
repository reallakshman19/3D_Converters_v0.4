#!/usr/bin/env python3
"""GLRD BM2 pinned-input native CII baseline-vs-candidate parity (no mass edits).

This is not a physical mass approval or a claim that estimated catalogue masses
are correct. The source is intentionally unchanged on both native routes.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile

EXPECTED = {
    "source": "6bcc477860fdbe9a80159839bf476a8c1e6ce7a966587a25bc62498709843151",
    "stage": "1d2469fe05d712cd1dd2da9913a840516ae686fb1616eb6d7b5e14d8918e2746",
    "linelist": "73496a1277cd1f39de823d57180ee0d8c4b1d72241923f1e558af2c7c805d007",
}
def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def row_input_from_uploaded_linelist(path: Path) -> list[dict]:
    # Mirrors the existing repo GLRD external-reference parser, but without
    # its unrelated B4110011 fixture assumption.
    with ZipFile(path) as archive:
        shared = ["".join(node.itertext()) for node in ET.fromstring(archive.read("xl/sharedStrings.xml"))]
        sheet = ET.fromstring(archive.read("xl/worksheets/sheet3.xml"))
        ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        result = []
        for row in sheet.findall(".//m:sheetData/m:row", ns):
            if int(row.attrib.get("r", "0")) < 9: continue
            cells = {}
            for c in row.findall("m:c", ns):
                v = c.find("m:v", ns)
                if v is None: continue
                col = re.match(r"[A-Z]+", c.attrib["r"]).group()
                cells[col] = shared[int(v.text)] if c.attrib.get("t") == "s" else v.text
            service, line = cells.get("B",""),cells.get("C","")
            if not service or not line: continue
            result.append({
                "lineNo": f"{service}{line}",
                "lineKey1": str(service), "lineKey2": str(line),
                "Piping Class": cells.get("V", ""),
                "Size": cells.get("U", ""),
                "Operating Pressure": cells.get("K", ""),
                "Operating Temperature": cells.get("L", ""),
                "Design Temp Max": cells.get("Y", ""),
                "Design Temp Min": cells.get("Z", ""),
            })
    if len(result) != 8:
        raise AssertionError(f"Uploaded LL_BM2 expected 8 engineering line rows; found {len(result)}")
    return result

def source_branch_ratings(source: Path) -> dict[str,str]:
    ns={"x":"http://aveva.com/pipeStress116.xsd"}
    root=ET.parse(source).getroot()
    branches=root.findall(".//x:Branch",ns)
    classes={"93833":"900","13451":"150"} # independently checked in uploaded piping-class master
    out={}
    for branch in branches:
        name=branch.findtext("x:Branchname",namespaces=ns) or ""
        match=re.search(r"-(\d{5})-\d{2}/B\d+$",name)
        if match is None or match.group(1) not in classes:
            raise AssertionError(f"Unknown input piping class {name!r}")
        out[name]=classes[match.group(1)]
    if len(branches)!=31 or len(out)!=31: raise AssertionError("Unexpected source branch census")
    return out

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--inputs",type=Path,required=True)
    p.add_argument("--before-root",type=Path,required=True)
    p.add_argument("--after-root",type=Path,required=True)
    p.add_argument("--out",type=Path,required=True)
    args=p.parse_args()
    args.out=args.out.resolve()
    args.before_root=args.before_root.resolve()
    args.after_root=args.after_root.resolve()
    args.out.mkdir(parents=True,exist_ok=True)
    source=args.inputs/"GLRD-1000-PI-01 - BM2.xml"
    stage=args.inputs/"STF_2026Nov03-0839_managed_stage.json"
    linelist=args.inputs/"LL_BM2.xlsx"
    for key,path in (("source",source),("stage",stage),("linelist",linelist)):
        if sha(path)!=EXPECTED[key]:raise AssertionError(f"Owner upload {key} SHA mismatch")
    linelist_rows=row_input_from_uploaded_linelist(linelist)
    branch_ratings=source_branch_ratings(source)
    config={
        "linelist":{"masterRows":linelist_rows,
                    "lineKeyTokenPositions":"4",
                    "fieldMap":{"lineNo":"lineNo","lineSeqNo":"lineNo"}},
        "overrides":{"rating":branch_ratings},
        "splitCondensedValveFlange":True,
    }
    stdout={}
    for name,root in (("before",args.before_root),("after",args.after_root)):
        runner=root/"converters/scripts/xml_to_cii2019_runtime_custody.py"
        out=args.out/(name+".cii")
        cmd=[sys.executable,str(runner),"--input",str(source),"--output",str(out),
             "--staged-json",str(stage),"--coords-mode","first",
             "--weight-scale","10","--split-condensed-valve-flange",
             "--support-config-json",json.dumps(config,separators=(",",":"))]
        run=subprocess.run(cmd,cwd=root,check=False,text=True,capture_output=True,timeout=210)
        stdout[name]={"returnCode":run.returncode,"stdout":run.stdout[-2500:],
                      "stderrTail":run.stderr[-3500:],"commandProgram":str(runner),
                      "outputSha256":sha(out) if out.is_file() else None,
                      "outputBytes":out.stat().st_size if out.is_file() else 0}
        if run.returncode!=0 or not out.is_file():
            (args.out/"native-parity-receipt.json").write_text(json.dumps(stdout,indent=2))
            raise RuntimeError(f"{name} native CII conversion failed: {run.stderr[-1800:]}")
    identical=(args.out/"before.cii").read_bytes()==(args.out/"after.cii").read_bytes()
    receipt={
      "schema":"GLRD-BM2-NATIVE-UNEDITED-PARITY-R1",
      "ownerSourceSha256":EXPECTED["source"],
      "ownerStagedSha256":EXPECTED["stage"],
      "ownerLinelistSha256":EXPECTED["linelist"],
      "branchCount":len(branch_ratings),"linelistRows":len(linelist_rows),
      "inputWeightChanges":0,
      "nativeCiiByteParity":identical,
      "massApproval":"NOT_GRANTING_APPROVAL",
      "limitation":"Native unedited baseline/candidate parity; not a real manually-reviewed 114-row mass publication",
      "runs":stdout,
    }
    (args.out/"native-parity-receipt.json").write_text(json.dumps(receipt,indent=2))
    if not identical:raise AssertionError("Native CII output bytes changed across untouched baseline and UI PR")
    print("GLRD native unedited CII parity PASS",json.dumps({
      "sha":stdout["after"]["outputSha256"],"bytes":stdout["after"]["outputBytes"],
      "sourceBranches":len(branch_ratings),"lineListRows":len(linelist_rows)
    }))

if __name__=="__main__":main()
