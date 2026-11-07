#!/usr/bin/env python3
"""Diagnostic only: locate each original GLRD PCOM span on native emitted edges."""
import sys, json, math, re, xml.etree.ElementTree as ET
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'converters/scripts'))
import xml_to_cii2019 as base
import xml_to_cii2019_patched as patched
import xml_to_cii2019_runtime_custody as runtime

def local(tag): return tag.rsplit('}',1)[-1]
def child(n,k): return next(((x.text or '').strip() for x in n if local(x.tag)==k),'')
def pos(n): return tuple(float(v) for v in child(n,'Position').split())
def vec(a,b):return tuple(a[i]-b[i] for i in range(3))
def norm(v):return math.hypot(*v)
def overlap(a,b,s,t):
  axis=vec(t,s);L=norm(axis)
  if L==0:return 0
  ax=tuple(c/L for c in axis)
  projections=[]
  for x in (a,b):
    diff=vec(x,s);p=sum(diff[i]*ax[i] for i in range(3))
    off=norm(tuple(diff[i]-p*ax[i] for i in range(3)))
    if off>0.2:return 0
    projections.append(p)
  return max(0,min(L,max(projections))-max(0,min(projections)))
def main():
  source,stage=[Path(s).resolve() for s in sys.argv[1:3]]
  config={'splitCondensedValveFlange':True}
  processed=patched._maybe_enrich_from_staged_json(source,stage,config)
  processed=patched._apply_process_data_to_xml(processed,config)
  original=ET.parse(processed).getroot()
  groups={}
  for br in original.iter():
    if local(br.tag)!='Branch':continue
    bn=child(br,'Branchname')
    for n in br:
      if local(n.tag)!='Node' or child(n,'ComponentType')!='PCOM':continue
      groups.setdefault((bn,child(n,'ComponentRefNo')),{})[child(n,'Endpoint')]=(pos(n),float(child(n,'Weight') or 0))
  doc=base._parse_xml_document(processed)
  model=patched._build_conversion_model(doc,{},None,config)
  records=[]
  for (branch,ref),ends in groups.items():
    if set(ends)!={'1','2'}: raise RuntimeError('missing PCOM pair '+ref)
    a,b=ends['1'][0],ends['2'][0]
    candidates=[]
    for i,e in enumerate(model.edges):
      if e.branch_name!=branch:continue
      v=overlap(e.from_node.position,e.to_node.position,a,b)
      if v>.2:
        candidates.append(dict(index=i+1,fromNode=e.from_node.node_number,toNode=e.to_node.node_number,
            fromType=e.from_node.component_type,toType=e.to_node.component_type,
            fromRef=e.from_node.component_ref_no,toRef=e.to_node.component_ref_no,
            fromRigid=e.from_node.rigid,toRigid=e.to_node.rigid,
            rigidPointer=model.edge_to_rigid_index.get(i,0),
            segmentLength=round(norm(vec(e.to_node.position,e.from_node.position)),3),
            overlapMm=round(v,3)))
    records.append(dict(branch=branch,ref=ref,spanMm=round(norm(vec(a,b)),3),candidates=candidates))
  print(json.dumps(dict(pcomCount=len(records),edges=len(model.edges),rigids=len(model.rigid_edges),records=records),indent=2))
if __name__=='__main__':main()
