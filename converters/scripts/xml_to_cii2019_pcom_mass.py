"""Explicit saved PCOM source mass -> one existing CII RIGID pointer.

No estimator, no source ComponentType rewrite, no edge split or new nodes.
Only a saved exact-source-key PCOM endpoint-2 override may be allocated.
Long mixed routes and ambiguous/geometrically invalid candidates fail closed.
"""
from __future__ import annotations
import math
from pathlib import Path
from typing import Any
import xml.etree.ElementTree as ET

import xml_to_cii2019 as base

COLLINEAR_TOLERANCE_MM = 0.2  # matches independent PR #5 geometric-overlap auditor


def _name(tag: str) -> str:
    return tag.rsplit('}', 1)[-1]


def _child(node: ET.Element, tag: str) -> str:
    return next(((e.text or '').strip() for e in node if _name(e.tag) == tag), '')


def _point(node: ET.Element) -> tuple[float, float, float] | None:
    fields = _child(node, 'Position').split()
    if len(fields) != 3: return None
    try:
        point = tuple(float(value) for value in fields)
    except ValueError:
        return None
    return point if all(math.isfinite(x) for x in point) else None


def _ref(value: str) -> str:
    return ''.join(value.lstrip('=').split()).upper()


def _physical_key(branch: str, node: ET.Element) -> str:
    # Exact parallel of xmlCiiWeightReviewNodeOverrideKey for sentinel -1.
    return f"{branch}::{_child(node,'ComponentRefNo')}|{_child(node,'Endpoint')}|{_child(node,'Position')}|PCOM"


def _positive(value: Any) -> float | None:
    if value is None or isinstance(value, bool) or str(value).strip() == '':return None
    try: number=float(value)
    except (ValueError, TypeError):return None
    return number if math.isfinite(number) and number > 0 else None


def _minus(a, b):
    return tuple(a[i] - b[i] for i in range(3))


def _norm(a):
    return math.hypot(*a)


def _interior_overlap(edge_start, edge_end, start, end) -> float:
    direction = _minus(end, start)
    length = _norm(direction)
    if length <= 0:return 0.
    axis = tuple(v / length for v in direction)
    projections = []
    for point in (edge_start, edge_end):
        offset = _minus(point, start)
        projected = sum(offset[i] * axis[i] for i in range(3))
        residual = _minus(offset, tuple(projected * a for a in axis))
        if _norm(residual) > COLLINEAR_TOLERANCE_MM:return 0.
        projections.append(projected)
    return max(0., min(length,max(projections)) - max(0.,min(projections)))


def source_explicit_pcom_components(input_xml: Path, config: dict[str, Any]) -> list[dict]:
    overrides = config.get('overrides',{}).get('rigidWeight',{})
    if not isinstance(overrides,dict):raise ValueError('CII_PCOM_OVERRIDE_MAP_INVALID')
    root=ET.parse(input_xml).getroot()
    branch_names={_child(branch,'Branchname') for branch in root.iter()
                  if _name(branch.tag)=='Branch'}
    # A selected-branch run may carry overrides saved for other branches.
    # Ignore those; refuse malformed or unlocated PCOM keys IN this run.
    requested={}
    for key,value in overrides.items():
        if not isinstance(key,str) or not key.endswith('|PCOM'):continue
        if key.partition('::')[0] not in branch_names:continue
        numeric=_positive(value)
        if numeric is None:raise ValueError('CII_PCOM_EXPLICIT_OVERRIDE_INVALID:'+key)
        requested[key]=numeric
    if not requested:return []
    groups: dict[tuple[str,str],list[ET.Element]] = {}
    for branch in root.iter():
        if _name(branch.tag)!='Branch':continue
        branch_name=_child(branch,'Branchname')
        for node in branch:
            if _name(node.tag)!='Node' or _child(node,'ComponentType').upper()!='PCOM':continue
            key=(branch_name,_ref(_child(node,'ComponentRefNo')))
            groups.setdefault(key,[]).append(node)
    results=[]
    consumed=set()
    for (branch,ref),records in groups.items():
        matches=[n for n in records if _physical_key(branch,n) in requested]
        if not matches:continue
        if len(records)!=2 or len(matches)!=1 or _child(matches[0],'Endpoint')!='2':
            raise ValueError(f'CII_PCOM_SOURCE_PAIR_AMBIGUOUS:{branch}:{ref}')
        pair={_child(n,'Endpoint'):n for n in records}
        if set(pair)!={'1','2'}:raise ValueError(f'CII_PCOM_SOURCE_ENDPOINTS_INVALID:{branch}:{ref}')
        start,end=(_point(pair[k]) for k in ('1','2'))
        if not start or not end or _norm(_minus(end,start))<=6:
            raise ValueError(f'CII_PCOM_PHYSICAL_SPAN_INVALID:{branch}:{ref}')
        key=_physical_key(branch,pair['2'])
        saved=requested[key]
        # Parity must have materialised precisely this saved mass in the engine
        # input. A guessed candidate or stale config alone is NOT sufficient.
        actual=_positive(_child(pair['2'],'Weight'))
        if actual is None or not math.isclose(actual,saved,rel_tol=0,abs_tol=1e-9):
            raise ValueError(f'CII_PCOM_SAVED_MASS_NOT_IN_ENGINE_INPUT:{branch}:{ref}')
        if _positive(_child(pair['1'],'Weight')) is not None:
            raise ValueError(f'CII_PCOM_ENDPOINT1_MASS_CONFLICT:{branch}:{ref}')
        consumed.add(key)
        results.append(dict(branch=branch,ref=ref,sourceKey=key,
                            start=start,end=end,spanMm=_norm(_minus(end,start)),
                            massKg=saved))
    missing=requested.keys()-consumed
    if missing:raise ValueError('CII_PCOM_SAVED_OWNER_NOT_FOUND:'+repr(sorted(missing)[:5]))
    return results


def allocate_explicit_pcom_to_rigid(model: base.ConversionModel, source: list[dict]):
    """Return {id(edge):kg}, witness. Never reuse a pointer or weighted edge."""
    if not source:return {},[]
    allocations={}
    witnesses=[]
    pointers=set()
    for component in source:
        matches=[]
        for index, edge in enumerate(model.edges):
            if edge.branch_name!=component['branch']:continue
            pointer=model.edge_to_rigid_index.get(index,0)
            if not pointer:continue
            overlap=_interior_overlap(edge.from_node.position,edge.to_node.position,
                component['start'],component['end'])
            if overlap<=COLLINEAR_TOLERANCE_MM:continue
            length=_norm(_minus(edge.to_node.position,edge.from_node.position))
            # A short physical PCOM cannot own a 608mm valve+flange route.
            # It must dominate the candidate emitted CII RIGID element,
            # not merely be an interior sliver of a long mixed element.
            if overlap < 0.5*length or overlap < 0.5*component['spanMm']:continue
            matches.append((index,edge,pointer,length,overlap))
        if len(matches)!=1:
            raise ValueError(f"CII_PCOM_RIGID_OWNER_AMBIGUOUS:{component['branch']}:{component['ref']}:{len(matches)}")
        index,edge,pointer,length,overlap=matches[0]
        if pointer in pointers or id(edge) in allocations:
            raise ValueError(f"CII_PCOM_RIGID_POINTER_REUSED:{component['branch']}:{component['ref']}")
        try:
            original=base._rigid_weight_for_edge(edge)
        except ValueError as exc:
            raise ValueError(f"CII_PCOM_EXISTING_OWNER_CONFLICT:{component['branch']}:{component['ref']}") from exc
        if original>0:
            raise ValueError(f"CII_PCOM_EXISTING_RIGID_MASS_CONFLICT:{component['branch']}:{component['ref']}")
        pointers.add(pointer)
        allocations[id(edge)]=component['massKg']
        witnesses.append(dict(branch=component['branch'],sourceRef=component['ref'],
            sourceKey=component['sourceKey'],sourcePhysicalSpanMm=round(component['spanMm'],5),
            elementIndex=index+1,fromNode=edge.from_node.node_number,toNode=edge.to_node.node_number,
            elementLengthMm=round(length,5),overlapMm=round(overlap,5),
            rigidPointer=pointer,massKg=component['massKg'],
            authority='SAVED_EXPLICIT_PCOM_REVIEW_ONLY'))
    return allocations,witnesses
