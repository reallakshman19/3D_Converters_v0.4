#!/usr/bin/env python3
"""Reproduce EF-05 baseline with the repository's existing native CII converter.
Never invent missing Phase-6 approvals; keep every scenario labelled.
"""
from __future__ import annotations
import hashlib, json, os, re, shutil, subprocess, sys, tempfile, zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
INPUT=ROOT/"Benchmarks/EF-05-PRO.TEST.xml"
STAGE_ZIP=ROOT/"Benchmarks/ASIM-1836_managed_stage-2.zip"
HISTORIC=ROOT/"Benchmarks/EF-05-PRO.TEST_enriched-3.xml"
SCRIPT_DIR=ROOT/"converters/scripts"
OUT=Path(os.environ.get("EF05_BASELINE_OUTPUT",str(ROOT/"ef05-baseline-output"))).resolve()
OUT.mkdir(parents=True, exist_ok=True)
USER_XML_GIT_BLOB="caf814c906e4155dcf388ac7ea822aeafec76780"
USER_STAGE_SHA="5450819c0f19aa6743c32cd29b72acc9df5b9c51dc6b1e6203e529f3af057790"
REPORTED={"element_count":616,"rigid_count":211,"restraint_count":200,"element_569_nodes":[7369,7370],"element_569_pointer":191,"element_569_weight_n":130.0}
FLAGS=[(2,30,39,1,0),(77,1040,1050,18,0),(119,1630,1640,33,0),
 (162,2240,2250,48,0),(205,2840,2850,63,0),(250,3380,3390,81,0),
 (259,3480,10000,84,0),(273,3590,3599,85,0),(298,3880,3889,94,0),
 (330,4220,4230,102,0),(380,4890,4900,115,0),(425,5480,5490,131,0),
 (472,6120,6130,147,0),(526,6780,6790,170,0),(554,7150,7160,185,0),
 (569,7369,7370,191,130),(608,7830,7840,206,0)]

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def blob_sha(path):
    b=Path(path).read_bytes()
    return hashlib.sha1(("blob "+str(len(b))+"\0").encode()+b).hexdigest()
def describe(path):
    p=Path(path)
    return {"path":str(p.relative_to(OUT)) if p.is_relative_to(OUT) else str(p.relative_to(ROOT)),
            "bytes":p.stat().st_size,"sha256":sha(p)}
def run(args, log):
    cp=subprocess.run(args,cwd=SCRIPT_DIR,capture_output=True,text=True)
    (OUT/log).write_text("command="+repr(args)+"\nexit="+str(cp.returncode)+"\nSTDOUT:\n"+cp.stdout+"\nSTDERR:\n"+cp.stderr,encoding="utf8")
    return {"exit_code":cp.returncode,"stdout_tail":cp.stdout[-1500:],"stderr_tail":cp.stderr[-1500:],"log":log}
def parse_cii(path):
    sections={}
    current=None
    for line in Path(path).read_text(encoding="utf8").splitlines():
        if line.startswith("#$ "):
            current=line[3:].strip()
            sections[current]=[]
        elif current is not None and line.strip():
            sections[current].append(line)
    required=["CONTROL","ELEMENTS","RIGID","RESTRANT"]
    for name in required:
        if name not in sections: raise ValueError("Missing CII section "+name)
    # Fixed record width: ELEMENTS=15 rows/element, each RIGID=1 row.
    controls=sections["CONTROL"]
    elements=sections["ELEMENTS"]
    rigid=sections["RIGID"]
    if len(elements)%15: raise ValueError("CII ELEMENT row count not divisible by 15")
    weights=[float(row.split()[0]) for row in rigid]
    result=[]
    for index in range(len(elements)//15):
        chunk=elements[index*15:index*15+15]
        # Native writer pads fields without always separating negative signs.
        numbers=re.findall(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?",chunk[0])
        if len(numbers)!=6: raise ValueError("Bad ELEMENT geometry "+str(index+1)+":"+chunk[0])
        ptr=int(chunk[12].split()[1])
        if not 0<=ptr<=len(weights): raise ValueError("Bad rigid pointer")
        result.append({"element":index+1,"from":int(float(numbers[0])),"to":int(float(numbers[1])),
                       "delta":[float(x) for x in numbers[2:5]],
                       "pointer":ptr,"weight_n":weights[ptr-1] if ptr else 0.0})
    control_e=int(controls[0].split()[0])
    control_r=int(controls[1].split()[1])
    if control_e!=len(result) or control_r!=len(weights):
        raise ValueError("CONTROL and physical CII sections disagree")
    section_counts={k:len(v) for k,v in sections.items()}
    by_number={x["element"]:x for x in result}
    checks=[]
    for idx,fr,to,ptr,w in FLAGS:
        actual=by_number.get(idx)
        same=bool(actual and actual["from"]==fr and actual["to"]==to and actual["pointer"]==ptr and abs(actual["weight_n"]-w)<.00001)
        checks.append({"element":idx,"reported":[fr,to,ptr,w],"baseline":actual,"exact_match":same})
    return {"elements_count":len(result),"rigid_count":len(weights),
            "restraint_record_lines":len(sections["RESTRANT"]),
            "sections":section_counts,"positive_rigid_count":sum(v>0 for v in weights),
            "positive_rigid_total_n":sum(v for v in weights if v>0),
            "element_569":by_number.get(569),
            "reported_flag_element_replay":checks,
            "flag_identity_exact_matches":sum(x["exact_match"] for x in checks),
            "_elements":result}

def convert(xml, name, staged=None):
    out=OUT/(name+".cii")
    cmd=[sys.executable,str(SCRIPT_DIR/"xml_to_cii2019_runtime_custody.py"),
         "--input",str(xml),"--output",str(out),
         "--coords-mode","first","--weight-scale","10",
         "--support-config-json","{}",
         "--split-condensed-valve-flange",
         "--use-restraint-type-based-on-json"]
    if staged: cmd+=["--staged-json",str(staged)]
    info=run(cmd,name+".native.log")
    if out.exists() and info["exit_code"]==0:
        try: info["cii"]=describe(out);info["metrics"]=parse_cii(out)
        except Exception as err: info["parse_error"]=repr(err)
    return info

def create_staged():
    with zipfile.ZipFile(STAGE_ZIP) as z:
        names=[x.filename for x in z.infolist() if x.filename.lower().endswith(".json")]
        if not names:raise ValueError("Repository staged ZIP lacks JSON")
        ranked=sorted(names,key=lambda n:z.getinfo(n).file_size,reverse=True)
        out=OUT/"ASIM-1836_managed_stage-2.json"
        out.write_bytes(z.read(ranked[0]))
        return out,{"zip_contents":names,"selected":ranked[0],
                    "exact_user_staged_sha256":sha(out)==USER_STAGE_SHA,**describe(out)}

def main():
    receipt={"schema":"ef05-source-to-cii-baseline/v1",
             "reproduction_type":"native-converter-no-user-review-config",
             "source_repo_commit":os.environ.get("GITHUB_SHA","unknown"),
             "required_approval_data_present":False,
             "source_xml":describe(INPUT),"source_blob_matches_uploaded":blob_sha(INPUT)==USER_XML_GIT_BLOB,
             "historical_enriched":describe(HISTORIC),
             "reported_run":REPORTED,
             "commands":"Actual repository xml_to_cii2019_runtime_custody.py; scale=10; coords=first; split=true; use-restraint-json=true; support_config={}; no review overrides"}
    try:
        stage,stage_info=create_staged()
        receipt["staged"]=stage_info
        # The historical repo XML is a useful separate reference, not the
        # canonical output of this run's defaults.
        receipt["historical"] = convert(HISTORIC,"historical_enriched_reference",stage)
        # No physical-mass override / no master review. Native conversion
        # directly from the original un-enriched XML.
        receipt["raw"] = convert(INPUT,"original_xml_no_enrichment")
        # Same staged enrichment and bend-radius policy as browser's Python
        # ENRICH_XML_SNIPPET, with unconfigured {} support config.
    except Exception as error:
        receipt["setup_error"]=repr(error)
    # We prepare Python enrichment as an independent, short executable stage.
    try:
        stage=OUT/"ASIM-1836_managed_stage-2.json"
        if not stage.exists():raise ValueError("Staged JSON unavailable")
        code="""
import shutil
from pathlib import Path
import xml_to_cii2019_patched as patched
from xml_to_cii2019_bend_radius_policy import apply_bend_radius_policy
root=Path(__import__('sys').argv[1]);stage=Path(__import__('sys').argv[2]);dest=Path(__import__('sys').argv[3])
cfg=patched._load_support_config('{}')
cfg['splitCondensedValveFlange']=True
a=patched._maybe_enrich_from_staged_json(root,stage,cfg)
b=patched._apply_process_data_to_xml(a,cfg)
final,info=apply_bend_radius_policy(b,cfg,dest)
if final.resolve()!=dest.resolve():shutil.copyfile(final,dest)
print('BEND_POLICY', info.get('enabled'), info.get('published'),info.get('removed'))
"""
        runner=OUT/"run_native_enrichment.py"
        runner.write_text(code,encoding="utf8")
        output=OUT/"EF-05-PRO.TEST_baseline_enriched.xml"
        cmd=[sys.executable,str(runner),str(INPUT),str(stage),str(output)]
        # Code resides in output directory; add the native scripts to PYTHONPATH.
        env=os.environ.copy();env["PYTHONPATH"]=str(SCRIPT_DIR)+os.pathsep+env.get("PYTHONPATH","")
        proc=subprocess.run(cmd,cwd=SCRIPT_DIR,env=env,capture_output=True,text=True)
        (OUT/"enrichment.native.log").write_text(repr(cmd)+"\ncode="+str(proc.returncode)+"\n"+proc.stdout+"\n"+proc.stderr,encoding="utf8")
        receipt["enrichment"]={"exit_code":proc.returncode,"stdout":proc.stdout[-1000:],"stderr_tail":proc.stderr[-1500:]}
        if proc.returncode==0 and output.exists():
            receipt["enrichment"]["xml"]=describe(output)
            receipt["generated"]=convert(output,"generated_baseline_enriched",stage)
            receipt["generated_matches_historical_enriched_bytes"]=output.read_bytes()==HISTORIC.read_bytes()
    except Exception as err:
        receipt["enrichment_error"]=repr(err)
    # Summarize source-identical counts & difference from a separate
    # previously reported owner's actual conversion.
    for name in ["generated","historical","raw"]:
        x=receipt.get(name,{})
        metrics=x.get("metrics")
        if not metrics:continue
        x["comparison_to_report"]={
            "element_delta":metrics["elements_count"]-REPORTED["element_count"],
            "rigid_delta":metrics["rigid_count"]-REPORTED["rigid_count"],
            "element_569_reported_match":next((y["exact_match"] for y in metrics["reported_flag_element_replay"] if y["element"]==569),False),
            "all_17_reported_flag_identities_match":metrics["flag_identity_exact_matches"]==17}
        # Reduce public JSON by dropping full ELEMENT array; retain CSV.
        rows=metrics.pop("_elements",[])
        import csv
        with (OUT/(name+"_elements.csv")).open("w",newline="",encoding="utf8") as f:
            writer=csv.DictWriter(f,fieldnames=["element","from","to","delta","pointer","weight_n"])
            writer.writeheader();writer.writerows(rows)
    (OUT/"replay_receipt.json").write_text(json.dumps(receipt,indent=2,ensure_ascii=False),encoding="utf8")
    print(json.dumps({k:{"status":v.get("exit_code"),"elements":v.get("metrics",{}).get("elements_count"),
                          "rigids":v.get("metrics",{}).get("rigid_count"),"sha256":v.get("cii",{}).get("sha256")}
            for k,v in receipt.items() if k in ["generated","historical","raw"]},indent=2))
    print("SOURCE_SHA_MATCH",receipt["source_blob_matches_uploaded"],"STAGE_SHA_MATCH",receipt.get("staged",{}).get("exact_user_staged_sha256"))
    print("RECEIPT",OUT/"replay_receipt.json")
    return 0 if receipt.get("generated",{}).get("cii") or receipt.get("historical",{}).get("cii") else 1

if __name__=="__main__":sys.exit(main())
