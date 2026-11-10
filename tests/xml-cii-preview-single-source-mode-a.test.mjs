import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  activateModeASource, createModeASourceEntry, commonModeASupportConfig,
} from '../tabs/xml-cii-2019-standalone/xml-cii-mode-a-batch.js';
import {
  importModeASources, replaceModeASourceSelection,
} from '../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-mode-a-state.js';
import { modeAExecutionRows } from '../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-mode-a-propagation.js';
import { renderModeAConsolidatedPreviewPanel } from '../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-mode-a-consolidated.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const xml = (name, a, b) =>
  `<PipeStressExport><Branches><Branch><Branchname>${name}</Branchname>
  <Node><NodeNumber>${a}</NodeNumber><NodeName>A</NodeName><Position>0 0 0</Position></Node>
  <Node><NodeNumber>${b}</NodeNumber><NodeName>B</NodeName><Position>100 0 0</Position></Node>
  </Branch></Branches></PipeStressExport>`;
const xmlA = xml('/S-001/B1', 10, 20);
const xmlB = xml('/S-002/B1', 30, 40);
const xmlC = xml('/S-003/B1', 50, 60);
const rows = (names) => names.map((name) => ({
  fileName: name + '.xml',
  sourceText: name === 'A' ? xmlA : name === 'B' ? xmlB : xmlC,
}));
const shared = JSON.stringify({
  regexTester: { activeFormatIndex: 1 },
  weight: { masterRows: [{ typeDesc: 'Approved reference (test)' }] },
});
const local = JSON.stringify({
  ...JSON.parse(shared),
  overrides: { rigidWeight: { '/S-001/B1::10': 15 } },
  linelist: { branchLineKeyMap: { '/S-001/B1': 'SOURCE-A-ONLY' } },
  weight: { masterRows: JSON.parse(shared).weight.masterRows,
    finalizedMatches: [{ key: 'A-only', weightKg: 15 }] },
});

function oldState() {
  const a = createModeASourceEntry({ fileName: 'A.xml', sourceText: xmlA, supportConfigJson: local });
  return {
    sourceKind: 'xml',
    sourceFile: {name:'A.xml'},
    sourceText: xmlA,
    supportConfigJson: local,
    branchSelection: a.branchSelection,
    stagedJsonText: '{"A":true}',
    masterContext: {rowCounts:{lineList:2}},
    result: {ok:true,ciiName:'stale-A.cii'},
    modeAConsolidatedPreviewResult: {sourceCount:2,rows:[]},
    pendingPhase6MassReview: {issueCount:1},
    sourceBatch: {
      mode:'separate-models',activeSourceId:a.sourceId,
      sources:[a],sharedSupportConfigJson:shared,
    },
  };
}

test('one newly selected XML replaces the previous loaded file and stale review state', () => {
  const next = replaceModeASourceSelection(oldState(),rows(['B'])).state;
  assert.equal(next.sourceBatch.sources.length,1);
  assert.equal(next.sourceBatch.sources[0].fileName,'B.xml');
  assert.equal(next.sourceText,xmlB);
  assert.equal(next.result,null);
  assert.equal(next.batchRunResult,null);
  assert.equal(next.modeAConsolidatedPreviewResult,null);
  assert.equal(next.pendingPhase6MassReview,null);
  assert.equal(next.masterContext.rowCounts.lineList,2,
    'shared imported masters should not be lost when source selection changes');
  const newConfig = JSON.parse(next.sourceBatch.sources[0].supportConfigJson);
  assert.equal(newConfig.regexTester.activeFormatIndex,1);
  assert.equal(newConfig.weight.masterRows.length,1);
  assert.equal(newConfig.overrides,undefined,'old mass approval must not leak');
  assert.equal(newConfig.linelist?.branchLineKeyMap,undefined,'old line map must not leak');
  assert.equal(newConfig.weight.finalizedMatches,undefined,'old weight match must not leak');
  assert.equal(next.sourceBatch.sources[0].workflow.result,null);
  assert.equal(modeAExecutionRows(next).length,1);
  assert.equal(renderModeAConsolidatedPreviewPanel(
    {appendChild(){throw new Error('Consolidated Preview rendered with one XML');}},
    {current:next},()=>{}),false);
});

test('new multi-file selection yields two independent models; later selecting one removes the previous batch', () => {
  const multi=replaceModeASourceSelection(oldState(),rows(['B','C'])).state;
  assert.equal(modeAExecutionRows(multi).length,2);
  assert.deepEqual(multi.sourceBatch.sources.map(s=>s.fileName),['B.xml','C.xml']);
  assert.notEqual(multi.sourceBatch.sources[0].sourceId,multi.sourceBatch.sources[1].sourceId);
  const single=replaceModeASourceSelection(multi,rows(['C'])).state;
  assert.equal(modeAExecutionRows(single).length,1);
  assert.deepEqual(single.sourceBatch.sources.map(s=>s.fileName),['C.xml']);
  assert.equal(renderModeAConsolidatedPreviewPanel(
    {appendChild(){throw new Error('Incorrect consolidated panel');}},
    {current:single},()=>{}),false);
});

test('intentional additive API remains available, and disabled/empty sources do not qualify for consolidated Preview', () => {
  const one=replaceModeASourceSelection(oldState(),rows(['B'])).state;
  const appended=importModeASources(one,rows(['C'])).state;
  assert.equal(modeAExecutionRows(appended).length,2,'explicit additive API must still work');
  const sourceB=appended.sourceBatch.sources[0];
  const sourceC=appended.sourceBatch.sources[1];
  const disabled={
    ...appended,
    sourceBatch:{...appended.sourceBatch,sources:[sourceB,{...sourceC,enabled:false}]},
  };
  assert.equal(renderModeAConsolidatedPreviewPanel(
    {appendChild(){throw new Error('Disabled source counted');}},
    {current:disabled},()=>{}),false);
  // Switch the active source before clearing the other source's text:
  // active-source synchronization intentionally mirrors the top-level text.
  const withBActive = activateModeASource(appended,sourceB.sourceId);
  const empty={
    ...withBActive,
    sourceBatch:{...withBActive.sourceBatch,
      sources:[sourceB,{...sourceC,sourceText:'',enabled:true}]},
  };
  assert.equal(renderModeAConsolidatedPreviewPanel(
    {appendChild(){throw new Error('Empty source counted');}},
    {current:empty},()=>{}),false);
});

test('Preview router uses native single-file view; batch preview only after two loaded XMLs',()=>{
  const source=read('../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-phase-panels-mode-a.js');
  const start=source.indexOf('function renderPreviewBatch(');
  const end=source.indexOf('function renderDiagnosticsBatch(',start);
  assert.ok(end>start);
  const preview=source.slice(start,end);
  assert.match(preview,/executions\.length <= 1/);
  assert.match(preview,/renderStandalonePreviewReportPanel\(card, sourceRef, render\)/);
  assert.match(preview,/renderModeAConsolidatedPreviewPanel\(card, stateRef, render\)/);
  assert.ok(preview.indexOf('if (executions.length <= 1)') <
    preview.indexOf('renderModeAConsolidatedPreviewPanel('));
  const events=read('../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-events-mode-a.js');
  assert.match(events,/replaceModeASourceSelection\(stateRef\.current, rows\)/);
  assert.doesNotMatch(events,/importModeASources\(stateRef\.current, rows\)/);
  assert.equal(commonModeASupportConfig(local).includes('rigidWeight'),false);
});
