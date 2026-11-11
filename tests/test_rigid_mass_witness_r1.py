"""Public synthetic adversarial tests; no private GLRD data and no converter imports."""
from __future__ import annotations
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

SCRIPT = Path(__file__).resolve().parents[1] / 'tools/rigid_mass_witness_r1.py'
spec = importlib.util.spec_from_file_location('rigid_mass_witness_r1', SCRIPT)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def row(*values):
    return f'{str(values[0]):>15}' + ''.join(f'{str(x):>13}' for x in values[1:])


def element(from_node, to_node, rigid_pointer):
    # Existing converter's public CII record contract: 15 lines; pointer row = 13.
    return ([row(from_node, to_node, 0, 1, 0, 100)] +
            [row(0, 0, 0, 0, 0, 0)] * 11 +
            [row(0, rigid_pointer, 0, 0, 0, 0)] +
            [row(0, 0, 0, 0, 0, 0)] + [row(0, 0, 0)])


def cii(elements, masses):
    return ('#$ VERSION\n' + row('5', '11', '1256') + '\n#$ CONTROL\n' +
            row(len(elements), 0, 0, 0, 0, 0) + '\n' +
            row(0, len(masses), 0, 0, 0, 0) + '\n' + row(0, 0, 0, 0, 0, 0) +
            '\n' + row(0) + '\n#$ ELEMENTS\n' +
            '\n'.join(line for e in elements for line in element(*e)) +
            '\n#$ AUX_DATA\n#$ RIGID\n' +
            '\n'.join(row(mass, 0) for mass in masses) + '\n#$ EXPJT\n')


def xml(records):
    root = ET.Element('PipeStressExport')
    branch = ET.SubElement(root, 'Branch')
    ET.SubElement(branch, 'Branchname').text = 'BR-01'
    for node_number, typ, ref, weight in records:
        n = ET.SubElement(branch, 'Node')
        for k, v in {'NodeNumber':node_number,'ComponentType':typ,
                     'ComponentRefNo':ref,'Position':f'{int(node_number)*100} 0 0',
                     'Rigid':'2' if typ == 'RIGID' else '0', 'Weight':weight}.items():
            if v is not None:
                ET.SubElement(n, k).text = str(v)
    return ET.tostring(root, encoding='utf-8')


class TestWitness(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.p = Path(self.tmp.name)
        self.source = self.p / 's.xml'
        self.source.write_bytes(xml([(10, 'PIPE', '', 0), (20, 'RIGID', 'SAME', 10),
                                     (30, 'PIPE', '', 0), (40, 'RIGID', 'SAME', 20)]))
        self.cii = self.p / 's.cii'
        self.cii.write_text(cii([(10, 20, 1), (30, 40, 2)], ['100.000', '200.000']))
        self.auth = self.p / 'approved.json'
        self.auth.write_text(json.dumps({'sourceSha256':m.digest(self.source), 'owners':[
            {'ownerId':'A','sourceRecordKeys':['B1:N2'],'approvedMassKg':10,
             'expectedElementOrdinals':[1],'authorityBasis':'synthetic owner A physical drawing',
             'approvedDecisionId':'A-D1'},
            {'ownerId':'B','sourceRecordKeys':['B1:N4'],'approvedMassKg':20,
             'expectedElementOrdinals':[2],'authorityBasis':'synthetic owner B physical drawing',
             'approvedDecisionId':'B-D1'}]}))

    def _report(self, masses=None, edges=None, authority=True):
        if masses is not None or edges is not None:
            self.cii.write_text(cii(edges or [(10,20,1),(30,40,2)], masses or ['100.000', '200.000']))
        source = m.source_records(self.source)
        owners = m.authority_records(self.auth if authority else None, source['sourceSha256'],
                                     {x['recordKey'] for x in source['records']})[0]
        return m.reconcile(source, m.parse_cii(self.cii), owners, m.Decimal(10), [])

    def test_independent_parser_and_public_record_layout(self):
        doc = m.parse_cii(self.cii)
        self.assertEqual((doc['elementCount'], doc['rigidCount']), (2,2))
        self.assertEqual([x['rigidPointer'] for x in doc['elements']], [1,2])
        self.assertEqual([x['emittedMass'] for x in doc['rigidRecords']], ['100.000','200.000'])

    def test_distinct_owners_same_ref_not_merged(self):
        report = self._report()
        self.assertEqual([x['status'] for x in report['ownerResults']], ['PASS','PASS'])
        self.assertEqual(report['status'], 'NOT_RUN')  # transformation proof still absent

    def test_global_total_equal_but_wrong_owner_placement(self):
        initial = self._report()
        swapped = self._report(['200.000', '100.000'])
        self.assertEqual(initial['globalEmittedMass'], swapped['globalEmittedMass'])
        self.assertEqual([x['status'] for x in swapped['ownerResults']], ['FAIL','FAIL'])
        self.assertEqual(swapped['status'], 'FAIL')

    def test_missing_mass(self):
        report = self._report(['100.000','0.000'])
        self.assertEqual(report['ownerResults'][1]['reasonCode'], 'OWNER_MASS_MISMATCH')

    def test_duplicate_mass(self):
        report = self._report(['100.000','100.000'])
        self.assertEqual(report['ownerResults'][1]['status'], 'FAIL')

    def test_incorrect_pointer(self):
        report = self._report(edges=[(10,20,2),(30,40,1)])
        self.assertEqual([x['status'] for x in report['ownerResults']], ['FAIL','FAIL'])

    def test_duplicate_pointer_detected(self):
        report = self._report(edges=[(10,20,1),(30,40,1)])
        codes = {x['code'] for x in report['findings']}
        self.assertIn('DUPLICATED_RIGID_POINTER', codes)
        self.assertIn('UNREFERENCED_RIGID', codes)

    def test_source_record_loss_not_silently_attributed(self):
        reduced = self.p / 'reduced.xml'
        reduced.write_bytes(xml([(10,'PIPE','',0), (30,'PIPE','',0),(40,'RIGID','SAME',20)]))
        before = m.source_records(self.source)
        after = m.source_records(reduced)
        events = m.compare_stages(before, after, 'after-cleanup')
        self.assertTrue(any(x['sourceKey'] == 'B1:N2' and x['stageKey'] is None for x in events))

    def test_renumbering_and_weight_change_evidence(self):
        new = self.p/'renumbered.xml'
        new.write_bytes(xml([(10,'PIPE','',0),(21,'RIGID','SAME',11),
                             (30,'PIPE','',0),(40,'RIGID','SAME',20)]))
        # Position is authoritative structural anchor: with changed position as
        # in this synthetic builder, the match is *not* invented.
        events = m.compare_stages(m.source_records(self.source),m.source_records(new),'renumber')
        self.assertEqual(next(x for x in events if x['sourceKey']=='B1:N2')['status'],'NOT_RUN')
        # In a true renumber, position stays unchanged, so report both changes.
        tree = ET.parse(new); ns = tree.getroot().find('Branch').findall('Node')
        ns[1].find('Position').text = '2000 0 0'
        tree.write(new)
        events = m.compare_stages(m.source_records(self.source),m.source_records(new),'renumber')
        change = next(x for x in events if x['sourceKey']=='B1:N2')['changes']
        self.assertEqual(change['nodeNumber'],{'before':'20','after':'21'})
        self.assertEqual(change['weight']['after']['numericKg'],'11')

    def test_unknown_authority_fails_closed_not_auto_owner(self):
        report = self._report(authority=False)
        self.assertEqual(report['status'],'NOT_RUN')
        self.assertIn('PHYSICAL_OWNERSHIP_UNRESOLVED',{x['code'] for x in report['findings']})

    def test_bad_approval_sha_refused(self):
        auth = json.loads(self.auth.read_text()); auth['sourceSha256']='0'*64
        self.auth.write_text(json.dumps(auth))
        with self.assertRaisesRegex(ValueError,'SHA-256 mismatch'):
            m.authority_records(self.auth,m.digest(self.source),set())

    def test_duplicate_source_owner_refused(self):
        auth=json.loads(self.auth.read_text());auth['owners'][1]['sourceRecordKeys']=['B1:N2']
        self.auth.write_text(json.dumps(auth))
        with self.assertRaisesRegex(ValueError,'previously claimed'):
            m.authority_records(self.auth,m.digest(self.source),{'B1:N2','B1:N4'})

    def test_out_of_range_pointer_refused(self):
        self.cii.write_text(cii([(10,20,3),(30,40,2)],['100','200']))
        with self.assertRaisesRegex(ValueError,'out of range'):
            m.parse_cii(self.cii)

    def test_truncated_element_block_refused(self):
        c=self.cii.read_text().splitlines(); c.pop(c.index('#$ ELEMENTS')+2)
        self.cii.write_text('\n'.join(c)+'\n')
        with self.assertRaisesRegex(ValueError,'record count mismatch'):
            m.parse_cii(self.cii)

    def test_source_duplicate_weight_exposes_pre_split_overcount_without_correction(self):
        # Two source records are explicitly assigned to ONE synthetic physical owner.
        # Raw 10 + 20 kg is not quietly equated to 10 kg approved mass.
        auth=json.loads(self.auth.read_text())
        auth['owners']=[{**auth['owners'][0], 'sourceRecordKeys':['B1:N2','B1:N4']}]
        self.auth.write_text(json.dumps(auth))
        self.cii.write_text(cii([(10,20,1),(30,40,2)], ['100.000','0.000']))
        report=self._report()
        finding=[x for x in report['findings'] if x['code']=='SOURCE_MULTIPLE_POSITIVE_WEIGHTS_OR_OVERCOUNT']
        self.assertEqual(len(finding),1)
        self.assertEqual(finding[0]['rawSumKg'],'30')
        self.assertEqual(report['ownerResults'][0]['status'],'PASS')
        self.assertEqual(report['status'],'NOT_RUN')  # owner lineage still unverified

    def test_independent_byte_parity_detects_one_character_drift(self):
        import argparse
        reference=self.p/'before.cii';reference.write_bytes(self.cii.read_bytes())
        self.cii.write_text(self.cii.read_text().replace('100.000','100.001',1))
        args=argparse.Namespace(source=self.source,cii=self.cii,stage=[],events=None,
                                authority=self.auth,weight_scale='10',
                                reference_cii=reference,out=self.p/'drift')
        self.assertEqual(m.run(args),1)
        rec=json.loads((args.out/'reconciliation_report.json').read_text())
        self.assertEqual(rec['ciiParity']['status'],'FAIL')
        self.assertEqual(rec['status'],'FAIL')

    def test_unassigned_positive_mass_is_flagged(self):
        self.cii.write_text(cii([(10,20,1),(30,40,2),(40,50,3)],
                                ['100.000','200.000','5.000']))
        report=self._report()
        self.assertIn('UNASSIGNED_EMITTED_MASS',{x['code'] for x in report['findings']})
        self.assertEqual(report['status'],'FAIL')

    def test_self_parity_is_not_false_pass(self):
        import argparse
        args=argparse.Namespace(source=self.source,cii=self.cii,stage=[],events=None,
                                authority=self.auth,weight_scale='10',
                                reference_cii=self.cii,out=self.p/'self')
        m.run(args)
        rec=json.loads((args.out/'reconciliation_report.json').read_text())
        self.assertEqual(rec['ciiParity']['status'],'NOT_RUN')

    def test_existing_receipts_never_overwritten(self):
        import argparse
        args=argparse.Namespace(source=self.source,cii=self.cii,stage=[],events=None,
                                authority=self.auth,weight_scale='10',
                                reference_cii=None,out=self.p/'existing')
        args.out.mkdir();pre=args.out/'run_receipt.json';pre.write_text('LOCKED')
        with self.assertRaisesRegex(ValueError,'Existing evidence'):
            m.run(args)
        self.assertEqual(pre.read_text(),'LOCKED')

    def test_invalid_weight_scale_refused(self):
        import argparse
        args=argparse.Namespace(source=self.source,cii=self.cii,stage=[],events=None,
                                authority=self.auth,weight_scale='0',
                                reference_cii=None,out=self.p/'weight_invalid')
        with self.assertRaisesRegex(ValueError,'must be positive'):
            m.run(args)

    def test_source_weight_states_and_sha(self):
        p=self.p/'states.xml'
        p.write_bytes(xml([(1,'RIGID','X',None),(2,'RIGID','X',''),
                           (3,'RIGID','X','0'),(4,'RIGID','X','not-a-number')]))
        w=m.source_records(p)
        self.assertEqual([r['weight']['state'] for r in w['records']],
                         ['ABSENT','BLANK','ZERO','INVALID'])
        self.assertEqual(w['sourceSha256'],hashlib.sha256(p.read_bytes()).hexdigest())

    def test_read_only_end_to_end_and_byte_parity(self):
        import argparse
        before_source=self.source.read_bytes();before_cii=self.cii.read_bytes()
        baseline=self.p/"before.cii"
        baseline.write_bytes(before_cii)
        args=argparse.Namespace(source=self.source,cii=self.cii,stage=[],events=None,
                                authority=self.auth,weight_scale='10',
                                reference_cii=baseline,out=self.p/'witness')
        self.assertEqual(m.run(args),0)
        self.assertEqual(self.source.read_bytes(),before_source)
        self.assertEqual(self.cii.read_bytes(),before_cii)
        rec=json.loads((args.out/'reconciliation_report.json').read_text())
        self.assertEqual(rec['ciiParity']['status'],'PASS')
        self.assertEqual(rec['status'],'NOT_RUN')
        self.assertEqual(len(list(args.out.glob('*.json'))),4)


if __name__=='__main__':
    unittest.main(verbosity=2)
