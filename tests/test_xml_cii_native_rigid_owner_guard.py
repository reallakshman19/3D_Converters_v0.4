"""Synthetic native writer regression: no flange mass on foreign entry spans.

This is a bounded ownership refusal, not a pipe/PCOM empirical calculator.
"""
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "converters" / "scripts"))
import xml_to_cii2019 as base  # noqa: E402


def node(ref, typ, ep, rigid, mass):
    return SimpleNamespace(
        component_ref_no=ref, component_type=typ, endpoint=ep,
        rigid=rigid, weight=mass,
    )


def edge(frm, to):
    return SimpleNamespace(from_node=frm, to_node=to)


class NativeRigidPhysicalOwnerTests(unittest.TestCase):
    def setUp(self):
        self.valve = node("=134234934/28060", "VALV", 2, 2, 47)
        self.flange_start = node("=134234934/28064", "FLAN", 1, 2, 15)
        self.flange_end = node("=134234934/28064", "RIGID", 2, 2, 15)

    def test_glrd_19_1_connection_must_refuse_full_flange_mass(self):
        with self.assertRaisesRegex(ValueError,
                "CII_RIGID_FLANGE_ENTRY_MASS_OWNER_UNVERIFIED"):
            base._rigid_weight_for_edge(edge(self.valve, self.flange_start))

    def test_109_mm_physical_flange_keeps_15kg(self):
        self.assertEqual(base._rigid_weight_for_edge(
            edge(self.flange_start, self.flange_end)), 15)

    def test_actual_rigid_payload_retains_flange_150n(self):
        payload = base._build_rigid_payload(SimpleNamespace(
            rigid_edges=[edge(self.flange_start, self.flange_end)]), 10)
        self.assertEqual(len(payload), 1)
        self.assertAlmostEqual(float(payload[0].split()[0]), 150)

    def test_fallback_from_rigid_to_foreign_flange_start_is_held(self):
        foreign_first = node("=134234934/28064", "FLAN", 1, None, 15)
        with self.assertRaisesRegex(ValueError,
                "CII_RIGID_FLANGE_ENTRY_MASS_OWNER_UNVERIFIED"):
            base._rigid_weight_for_edge(edge(self.valve, foreign_first))

    def test_zero_mass_foreign_connection_not_fabricated(self):
        zero = node("=134234934/28064", "FLAN", 1, 2, 0)
        self.assertEqual(base._rigid_weight_for_edge(edge(self.valve, zero)), 0)

    def test_missing_identity_positive_foreign_entry_is_held(self):
        unknown = node("", "FLAN", 1, 2, 15)
        with self.assertRaisesRegex(ValueError,
                "CII_RIGID_FLANGE_ENTRY_MASS_OWNER_UNVERIFIED"):
            base._rigid_weight_for_edge(edge(self.valve, unknown))

    def test_same_component_reference_may_pass_this_bounded_guard(self):
        # Not mass-conservation authority: later aggregate reconciliation needed.
        first = node("134234934/28064", "FLAN", 1, 2, 15)
        self.assertEqual(base._rigid_weight_for_edge(
            edge(self.flange_start, first)), 15)

    def test_short_heavy_rigid_is_accepted(self):
        first = node("=HEAVY", "INST", 1, None, 110)
        last = node("=HEAVY", "INST", 2, 2, 110)
        self.assertEqual(base._rigid_weight_for_edge(edge(first, last)), 110)

    def test_nonrigid_edge_preserved(self):
        first = node("=V", "VALV", 2, None, 47)
        last = node("=F", "FLAN", 1, None, 15)
        self.assertEqual(base._rigid_weight_for_edge(edge(first, last)), 0)

    def test_xml_parser_preserves_original_component_ref_no(self):
        xml = """<PipeStressExport><Pipe><Branch>
          <Branchname>B1</Branchname>
          <Node><NodeNumber>1119</NodeNumber><Endpoint>2</Endpoint>
            <ComponentType>VALV</ComponentType>
            <ComponentRefNo>=134234934/28060</ComponentRefNo>
            <Position>0 0 0</Position><Rigid>2</Rigid><Weight>47</Weight></Node>
          <Node><NodeNumber>10020</NodeNumber><Endpoint>1</Endpoint>
            <ComponentType>FLAN</ComponentType>
            <ComponentRefNo>=134234934/28064</ComponentRefNo>
            <Position>0 0 19.1</Position><Rigid>2</Rigid><Weight>15</Weight></Node>
        </Branch></Pipe></PipeStressExport>"""
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "synthetic.xml"
            p.write_text(xml, encoding="utf-8")
            doc = base._parse_xml_document(p)
        parsed = doc.branches[0].nodes
        self.assertEqual([n.component_ref_no for n in parsed],
            ["=134234934/28060", "=134234934/28064"])
        with self.assertRaisesRegex(ValueError,
                "CII_RIGID_FLANGE_ENTRY_MASS_OWNER_UNVERIFIED"):
            base._rigid_weight_for_edge(edge(parsed[0], parsed[1]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
