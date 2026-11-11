#!/usr/bin/env python3
"""Read-only PSI116 source / independently parsed CII mass custody witness (R1).

No imports from the converter; no rewriting inputs or outputs. Physical ownership
requires an independently supplied, SHA-bound authorization file. CII is evidence
of emitted mass only, never evidence of owner identity.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET

SCHEMA = "xml-cii-rigid-postsplit-r1/v1"
VALID_STATUS = {"PASS", "FAIL", "NOT_RUN", "NOT_APPLICABLE"}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def local(tag: str) -> str:
    return tag.split("}")[-1]


def child(node: ET.Element, key: str) -> str | None:
    match = next((x for x in node if local(x.tag) == key), None)
    return None if match is None else (match.text if match.text is not None else "")


def value(node: ET.Element, key: str) -> str:
    return (child(node, key) or "").strip()


def weight_state(raw: str | None) -> dict:
    if raw is None:
        return {"state": "ABSENT", "raw": None, "numericKg": None}
    if not raw.strip():
        return {"state": "BLANK", "raw": raw, "numericKg": None}
    try:
        number = Decimal(raw.strip().replace(",", ""))
        if not number.is_finite():
            raise InvalidOperation
        state = "POSITIVE" if number > 0 else "NEGATIVE" if number < 0 else "ZERO"
        return {"state": state, "raw": raw, "numericKg": str(number)}
    except (InvalidOperation, ValueError):
        return {"state": "INVALID", "raw": raw, "numericKg": None}


def source_records(path: Path) -> dict:
    root = ET.fromstring(path.read_bytes())
    records = []
    branch_index = 0
    for branch in root.iter():
        if local(branch.tag) != "Branch":
            continue
        branch_index += 1
        branch_name = value(branch, "Branchname")
        node_index = 0
        for node in branch:
            if local(node.tag) != "Node":
                continue
            node_index += 1
            record = {
                "recordKey": f"B{branch_index}:N{node_index}",
                "branchOccurrence": branch_index,
                "branchName": branch_name,
                "recordOrdinal": node_index,
                "nodeNumber": value(node, "NodeNumber"),
                "componentRefNo": value(node, "ComponentRefNo"),
                "componentType": value(node, "ComponentType"),
                "endpoint": value(node, "Endpoint"),
                "rigid": value(node, "Rigid"),
                "position": value(node, "Position"),
                "elementLengthMm": value(node, "ElementLengthMm"),
                "weight": weight_state(child(node, "Weight")),
                "physicalOwner": None,
                "ownerAuthority": "UNKNOWN: node number and component reference are insufficient",
            }
            records.append(record)
    return {"schema": SCHEMA, "sourceSha256": digest(path), "recordCount": len(records),
            "records": records, "provenance": "INDEPENDENT_SOURCE_PARSE"}


def structural_key(record: dict) -> tuple:
    return (record["branchOccurrence"], record["componentRefNo"],
            record["componentType"], record["endpoint"], record["rigid"], record["position"])


def compare_stages(before: dict, after: dict, stage: str) -> list[dict]:
    """Only claim a link for a uniquely equal structural fingerprint.

    When same branch/ordinal, and structure is unchanged, allow a renumbering
    or changed weight. When records are deleted/inserted, only unique keys can
    be linked; nonunique candidates remain unresolved.
    """
    prior = before["records"]
    later = after["records"]
    index: dict[tuple, list[dict]] = defaultdict(list)
    for row in later:
        index[structural_key(row)].append(row)
    already = set()
    events = []
    for old in prior:
        candidates = [n for n in index[structural_key(old)] if n["recordKey"] not in already]
        if len(candidates) == 1 and len(index[structural_key(old)]) == 1:
            new = candidates[0]
            already.add(new["recordKey"])
            changes = {field: {"before": old[field], "after": new[field]}
                       for field in ("nodeNumber", "weight") if old[field] != new[field]}
            events.append({"stage": stage, "sourceKey": old["recordKey"],
                           "stageKey": new["recordKey"], "status": "PASS",
                           "basis": "INDEPENDENT_UNIQUE_STRUCTURAL_MATCH", "changes": changes})
        elif not candidates:
            events.append({"stage": stage, "sourceKey": old["recordKey"],
                           "stageKey": None, "status": "NOT_RUN", "reason": "NO_SURVIVING_UNIQUE_MATCH"})
        else:
            events.append({"stage": stage, "sourceKey": old["recordKey"],
                           "stageKey": None, "status": "NOT_RUN", "reason": "AMBIGUOUS_MATCH"})
    for new in later:
        if new["recordKey"] not in already:
            events.append({"stage": stage, "sourceKey": None, "stageKey": new["recordKey"],
                           "status": "NOT_RUN", "reason": "UNMATCHED_LATER_RECORD"})
    return events


def fixed_fields(line: str) -> list[str]:
    return [line[:15].strip()] + [line[15 + 13 * i:28 + 13 * i].strip()
                                      for i in range(max(0, (len(line) - 15 + 12) // 13))]


def number(raw: str, context: str) -> Decimal:
    try:
        n = Decimal(raw)
        if not n.is_finite():
            raise InvalidOperation
        return n
    except (InvalidOperation, ValueError):
        raise ValueError(f"{context}: invalid numeric value {raw!r}") from None


def integral(raw: str, context: str) -> int:
    n = number(raw, context)
    if n != n.to_integral_value():
        raise ValueError(f"{context}: not an integer {raw!r}")
    return int(n)


def parse_cii(path: Path) -> dict:
    """Independent fixed-record parser; never references a converter model."""
    sections: dict[str, list[str]] = {}
    current = None
    for raw_line in path.read_bytes().decode("utf-8-sig").splitlines():
        if raw_line.startswith("#$ "):
            current = raw_line[3:].strip()
            if current in sections:
                raise ValueError(f"Repeated CII section: {current}")
            sections[current] = []
        elif current is not None:
            sections[current].append(raw_line)
    for required in ("CONTROL", "ELEMENTS", "RIGID"):
        if required not in sections:
            raise ValueError(f"Missing CII section: {required}")
    if len(sections["CONTROL"]) < 2:
        raise ValueError("CONTROL needs at least two rows")
    control1 = fixed_fields(sections["CONTROL"][0]); control2 = fixed_fields(sections["CONTROL"][1])
    element_count = integral(control1[0], "CONTROL elements")
    rigid_count = integral(control2[1], "CONTROL rigids")
    element_rows = sections["ELEMENTS"]; rigid_rows = sections["RIGID"]
    if len(element_rows) != 15 * element_count:
        raise ValueError(f"ELEMENTS record count mismatch: {len(element_rows)} rows for {element_count} elements")
    if len(rigid_rows) != rigid_count:
        raise ValueError(f"RIGID record count mismatch: {len(rigid_rows)} rows for {rigid_count} rigids")
    rigid_records = []
    for i, line in enumerate(rigid_rows, 1):
        fields = fixed_fields(line)
        if len(fields) < 2:
            raise ValueError(f"RIGID {i} missing fields")
        emitted = number(fields[0], f"RIGID {i} mass")
        rigid_records.append({"rigidOrdinal": i, "emittedMass": str(emitted),
                              "massToken": fields[0], "secondToken": fields[1],
                              "ciiLine": line})
    elements = []
    pointers = Counter()
    for i in range(element_count):
        record = element_rows[15*i:15*(i+1)]
        nodes = fixed_fields(record[0]); refs = fixed_fields(record[12])
        if len(nodes) < 2 or len(refs) < 2:
            raise ValueError(f"ELEMENT {i+1}: incomplete 15-line record")
        pointer = integral(refs[1], f"ELEMENT {i+1} rigid pointer")
        if not 0 <= pointer <= rigid_count:
            raise ValueError(f"ELEMENT {i+1}: pointer {pointer} out of range 0..{rigid_count}")
        if pointer:
            pointers[pointer] += 1
        elements.append({"elementOrdinal": i+1, "fromNode": integral(nodes[0], f"ELEMENT {i+1} from"),
                         "toNode": integral(nodes[1], f"ELEMENT {i+1} to"),
                         "rigidPointer": pointer,
                         "emittedMass": rigid_records[pointer-1]["emittedMass"] if pointer else None})
    anomalies = []
    for i in range(1, rigid_count+1):
        if not pointers[i]:
            anomalies.append({"code": "UNREFERENCED_RIGID", "rigidOrdinal": i})
        if pointers[i] > 1:
            anomalies.append({"code": "DUPLICATED_RIGID_POINTER", "rigidOrdinal": i,
                              "pointerCount": pointers[i]})
    return {"schema": SCHEMA, "ciiSha256": digest(path), "elementCount": element_count,
            "rigidCount": rigid_count, "elements": elements, "rigidRecords": rigid_records,
            "anomalies": anomalies, "provenance": "INDEPENDENT_OUTPUT_PARSE"}


def _equal_to_token(actual: str, approved_mass: Decimal) -> bool:
    """Respect serialization quantization (half of the last emitted decimal unit)."""
    emitted = number(actual, "emitted rigid mass")
    step = Decimal(1).scaleb(emitted.as_tuple().exponent)
    return abs(emitted - approved_mass) <= step / 2


def authority_records(path: Path | None, source_sha: str, keys: set[str]) -> tuple[list[dict], list[dict]]:
    if path is None:
        return [], []
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("sourceSha256") != source_sha:
        raise ValueError("Authority file source SHA-256 mismatch: refusing ownership assignment")
    owners = data.get("owners")
    if not isinstance(owners, list):
        raise ValueError("Authorization must contain owners[]")
    seen_ids = set(); seen_source = set(); seen_element = set(); findings = []
    for row in owners:
        oid = row.get("ownerId", "")
        if not isinstance(oid, str) or not oid or oid in seen_ids:
            raise ValueError("Each ownerId must be a unique nonblank string")
        seen_ids.add(oid)
        if not row.get("authorityBasis") or not row.get("approvedDecisionId"):
            raise ValueError(f"Owner {oid}: explicit authorityBasis and approvedDecisionId required")
        mass = number(str(row.get("approvedMassKg", "")), "approvedMassKg")
        if mass < 0:
            raise ValueError(f"Owner {oid}: negative approved mass")
        source_rows = row.get("sourceRecordKeys", [])
        edge_rows = row.get("expectedElementOrdinals", [])
        if not source_rows or not edge_rows or any(not isinstance(x, int) or x <= 0 for x in edge_rows):
            raise ValueError(f"Owner {oid}: sourceRecordKeys and positive expectedElementOrdinals required")
        for key in source_rows:
            if key not in keys or key in seen_source:
                raise ValueError(f"Owner {oid}: unknown or previously claimed source record {key}")
            seen_source.add(key)
        for edge in edge_rows:
            if edge in seen_element:
                raise ValueError(f"Element {edge} has multiple assigned physical owners")
            seen_element.add(edge)
        findings.append({"ownerId": oid, "sourceRecordKeys": source_rows,
                         "expectedElementOrdinals": edge_rows, "approvedMassKg": str(mass),
                         "approvedDecisionId": row["approvedDecisionId"],
                         "authorityBasis": row["authorityBasis"]})
    return findings, []


def reconcile(source: dict, output: dict | None, owners: list[dict],
              scale: Decimal, events: list[dict]) -> dict:
    results = []; issues = []
    source_by_key = {r["recordKey"]: r for r in source["records"]}
    elements = {x["elementOrdinal"]: x for x in output["elements"]} if output else {}
    for owner in owners:
        oid = owner["ownerId"]; expected = number(owner["approvedMassKg"], oid) * scale
        edge_rows = owner["expectedElementOrdinals"]
        found = [elements.get(n) for n in edge_rows]
        if not output:
            status, code = "NOT_RUN", "OUTPUT_WITNESS_MISSING"
        elif any(x is None for x in found):
            status, code = "FAIL", "EXPECTED_ELEMENT_MISSING"
        elif any(x["rigidPointer"] == 0 for x in found):
            status, code = "FAIL", "EXPECTED_RIGID_POINTER_MISSING"
        elif not _equal_to_token(str(sum((number(x["emittedMass"], "mass") for x in found), Decimal(0))), expected):
            status, code = "FAIL", "OWNER_MASS_MISMATCH"
        else:
            status, code = "PASS", "MASS_AND_PLACEMENT_MATCH_EXPLICIT_AUTHORITY"
        raw_weights = [source_by_key[k]["weight"] for k in owner["sourceRecordKeys"]]
        raw_sum = sum((number(x["numericKg"], "source weight") for x in raw_weights
                       if x["numericKg"] is not None and number(x["numericKg"], "source weight") > 0), Decimal(0))
        results.append({**owner, "status": status, "reasonCode": code,
                        "sourceRawWeightStates": raw_weights,
                        "sourceRawPositiveSumKg": str(raw_sum),
                        "expectedEmittedMass": str(expected),
                        "observedElementMasses": [{"elementOrdinal": n,
                           "emittedMass": elements[n]["emittedMass"],
                           "rigidPointer": elements[n]["rigidPointer"]} for n in edge_rows if n in elements],
                        "authorityClass": "USER_SUPPLIED_EXPLICIT"})
        if raw_sum > number(owner["approvedMassKg"], "approved mass"):
            issues.append({"code": "SOURCE_MULTIPLE_POSITIVE_WEIGHTS_OR_OVERCOUNT",
                           "ownerId": oid, "rawSumKg": str(raw_sum),
                           "firstObservableStage": "SOURCE_WEIGHT_RECORDS",
                           "severity": "REVIEW_REQUIRED_NOT_AUTO_CORRECTED"})
        if status == "FAIL":
            issues.append({"code": code, "ownerId": oid, "firstObservableStage": "FINAL_CII_OUTPUT"})
    if output:
        for anomaly in output["anomalies"]:
            issues.append({**anomaly, "firstObservableStage": "FINAL_CII_OUTPUT"})
        assigned = {n for o in owners for n in o["expectedElementOrdinals"]}
        if owners:
            for edge in output["elements"]:
                if edge["elementOrdinal"] not in assigned and edge["rigidPointer"]:
                    if number(edge["emittedMass"], "mass") != 0:
                        issues.append({"code": "UNASSIGNED_EMITTED_MASS", "elementOrdinal": edge["elementOrdinal"],
                                       "firstObservableStage": "FINAL_CII_OUTPUT"})
    if not owners:
        issues.append({"code": "PHYSICAL_OWNERSHIP_UNRESOLVED", "firstObservableStage": "SOURCE_AUTHORIZATION"})
    unresolved_stages = [event for event in events if event.get("status") != "PASS"
                         and event.get("provenance") != "PRODUCER_INHERITED"]
    if unresolved_stages:
        issues.append({"code": "UNRESOLVED_STAGE_RECORDS", "count": len(unresolved_stages),
                       "firstObservableStage": "TRANSFORMATION"})
    # Stage snapshots or producer events do NOT prove a source record arrived
    # at a particular final CII ELEMENT. A true final-edge linkage witness is
    # required, and this independent after-the-fact reader cannot invent it.
    issues.append({"code": "FINAL_ELEMENT_LINEAGE_UNVERIFIED",
                   "firstObservableStage": "POST_SPLIT_FINAL_EDGE"})
    overall = "FAIL" if any(x["status"] == "FAIL" for x in results) or any(
        x["code"] not in {"PHYSICAL_OWNERSHIP_UNRESOLVED", "UNRESOLVED_STAGE_RECORDS", "FINAL_ELEMENT_LINEAGE_UNVERIFIED", "SOURCE_MULTIPLE_POSITIVE_WEIGHTS_OR_OVERCOUNT"} for x in issues
    ) else "NOT_RUN"
    return {"schema": SCHEMA, "status": overall, "ownerResults": results,
            "findings": issues, "firstObservableDivergence": issues[0] if issues else None,
            "globalEmittedMass": str(sum((number(x["emittedMass"], "RIGID mass") for x in output["rigidRecords"]), Decimal(0))) if output else None,
            "caveat": "Global mass agreement never establishes physical ownership or correct placement.",
            "provenance": {"source": "INDEPENDENT_SOURCE_PARSE", "output": "INDEPENDENT_OUTPUT_PARSE" if output else "NOT_RUN",
                           "authorization": "USER_SUPPLIED_EXPLICIT" if owners else "NOT_RUN",
                           "transformEvents": "PRODUCER_INHERITED_OR_EXTERNAL_UNVERIFIED" if events else "NOT_RUN"}}


def run(args: argparse.Namespace) -> int:
    scale = number(str(args.weight_scale), "--weight-scale")
    if scale <= 0:
        raise ValueError("--weight-scale must be positive")
    names = ("source_lineage_witness.json", "output_witness.json",
             "reconciliation_report.json", "run_receipt.json")
    if any((args.out / name).exists() for name in names):
        raise ValueError("Existing evidence files found: use a fresh --out directory")
    original = source_records(args.source)
    keys = {x["recordKey"] for x in original["records"]}
    owners, _ = authority_records(args.authority, original["sourceSha256"], keys)
    records_by_key = {x["recordKey"]: x for x in original["records"]}
    for owner in owners:
        for key in owner["sourceRecordKeys"]:
            records_by_key[key]["physicalOwner"] = owner["ownerId"]
            records_by_key[key]["ownerAuthority"] = owner["approvedDecisionId"]
    stages = []; events = []; previous = original
    for expression in args.stage:
        if "=" not in expression:
            raise ValueError("Each --stage must be NAME=FILE")
        name, filename = expression.split("=", 1)
        stage = source_records(Path(filename))
        stages.append({"stage": name, "sha256": stage["sourceSha256"], "recordCount": stage["recordCount"]})
        events.extend(compare_stages(previous, stage, name)); previous = stage
    external_events = json.loads(args.events.read_text(encoding="utf-8")) if args.events else []
    if not isinstance(external_events, list):
        raise ValueError("--events must contain a JSON list")
    events.extend({**event, "provenance": "PRODUCER_INHERITED"} for event in external_events)
    output = parse_cii(args.cii) if args.cii else None
    source = {**original, "stages": stages, "transformEvents": events,
              "authorizations": [{k:v for k,v in x.items() if k != "authorityBasis"} for x in owners]}
    report = reconcile(source, output, owners, scale, events)
    parity = None
    if args.reference_cii:
        if args.cii is None:
            raise ValueError("--reference-cii requires --cii")
        is_self = args.cii.resolve() == args.reference_cii.resolve()
        parity = {"status": "NOT_RUN" if is_self else "PASS" if args.cii.read_bytes() == args.reference_cii.read_bytes() else "FAIL",
                  "referenceSha256": digest(args.reference_cii),
                  "emittedSha256": digest(args.cii) if args.cii else None,
                  "comparison": "INVALID_SELF_COMPARISON" if is_self else "INDEPENDENT_BYTE_COMPARISON"}
        if parity["status"] == "FAIL":
            report["status"] = "FAIL"
            report["findings"].append({"code": "CII_BYTE_DRIFT", "firstObservableStage": "FINAL_CII_OUTPUT"})
    output_document = output or {"schema": SCHEMA, "status": "NOT_RUN", "reason": "No --cii supplied"}
    save(args.out / "source_lineage_witness.json", source)
    save(args.out / "output_witness.json", output_document)
    save(args.out / "reconciliation_report.json", {**report, "ciiParity": parity or {"status": "NOT_RUN"}})
    save(args.out / "run_receipt.json", {"sourceSha256": original["sourceSha256"],
            "outputSha256": digest(args.cii) if args.cii else None,
            "sourceStatus": "PASS", "outputStatus": "PASS" if output else "NOT_RUN",
            "ownerStatus": report["status"], "ciiParityStatus": parity["status"] if parity else "NOT_RUN",
            "converterExecution": "NOT_RUN", "codeUnderTest": SCHEMA})
    return 1 if report["status"] == "FAIL" else 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source", type=Path, required=True, help="Source XML. Never modified")
    p.add_argument("--cii", type=Path, help="Existing emitted CII. Never modified")
    p.add_argument("--stage", action="append", default=[], help="Ordered NAME=XML snapshot")
    p.add_argument("--events", type=Path, help="Optional producer trace events JSON; never independent authority")
    p.add_argument("--authority", type=Path, help="SHA-bound physical owner authorization JSON")
    p.add_argument("--weight-scale", type=str, required=True, help="Explicit mass-to-emitted-weight factor from actual invocation")
    p.add_argument("--reference-cii", type=Path, help="Before-trace CII for byte parity")
    p.add_argument("--out", type=Path, required=True, help="Only output directory")
    args = p.parse_args()
    try:
        return run(args)
    except (OSError, ValueError, ET.ParseError, KeyError, TypeError) as exc:
        print(f"FAIL-CLOSED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
