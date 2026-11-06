"""Real command-line XML->CII regression for the physical-owner guard."""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONVERTER = ROOT / "converters" / "scripts" / "xml_to_cii2019.py"


def node(number, endpoint, kind, ref, z, rigid, kg):
    return (f"<Node><NodeNumber>{number}</NodeNumber><Endpoint>{endpoint}</Endpoint>"
            f"<ComponentType>{kind}</ComponentType><ComponentRefNo>{ref}</ComponentRefNo>"
            f"<Position>0 0 {z}</Position><Rigid>{rigid}</Rigid>"
            f"<Weight>{kg}</Weight></Node>")


def source(nodes):
    return ("<PipeStressExport><Pipe><Branch><Branchname>B1</Branchname>"
            + "".join(nodes) + "</Branch></Pipe></PipeStressExport>")


def execute(xml):
    with tempfile.TemporaryDirectory() as d:
        inp, out = Path(d) / "source.xml", Path(d) / "source.cii"
        inp.write_text(xml, encoding="utf-8")
        process = subprocess.run([
            sys.executable, str(CONVERTER), "--input", str(inp),
            "--output", str(out), "--weight-scale", "10",
        ], capture_output=True, text=True)
        return process.returncode, process.stdout, process.stderr, (
            out.read_text(encoding="utf-8") if out.exists() else None)


class NativeCliGuard(unittest.TestCase):
    def test_real_cli_refuses_connection_entering_foreign_flange(self):
        xml = source([
            node(1119, 2, "VALV", "=134234934/28060", 0, 2, 47),
            node(-1, 1, "PCOM", "=134234934/28062", 3.2, 0, 0),
            node(-1, 2, "PCOM", "=134234934/28062", 15.9, 0, 0),
            node(10020, 1, "FLAN", "=134234934/28064", 19.1, 2, 15),
            node(1120, 2, "RIGID", "=134234934/28064", 128.1, 2, 15),
        ])
        code, stdout, stderr, artifact = execute(xml)
        self.assertNotEqual(code, 0, stdout + stderr)
        self.assertIn("CII_RIGID_FLANGE_ENTRY_MASS_OWNER_UNVERIFIED", stderr)
        self.assertIsNone(artifact, "Cannot publish a partial/ambiguous CII")

    def test_real_cli_preserves_109mm_flange_150n(self):
        xml = source([
            node(10020, 1, "FLAN", "=134234934/28064", 19.1, 2, 15),
            node(1120, 2, "RIGID", "=134234934/28064", 128.1, 2, 15),
        ])
        code, stdout, stderr, artifact = execute(xml)
        self.assertEqual(code, 0, stdout + stderr)
        self.assertIsNotNone(artifact)
        self.assertIn("#$ RIGID\n", artifact)
        records = artifact.split("#$ RIGID\n", 1)[1].split("#$ ", 1)[0].splitlines()
        self.assertEqual(len(records), 1)
        self.assertAlmostEqual(float(records[0].split()[0]), 150)


if __name__ == "__main__":
    unittest.main(verbosity=2)
