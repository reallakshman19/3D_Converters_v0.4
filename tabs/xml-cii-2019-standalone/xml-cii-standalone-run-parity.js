// Standalone XML→CII run parity
// -----------------------------
// The parent Model Converters workflow enriches the XML in the browser
// (process data, staged-support restraints with CMPSUPGAP gaps, DTXR
// annotations, weight master matches, valve/flange split renumbering) BEFORE
// the Python conversion runs. This module reuses that enrichment authority and
// now emits deterministic evidence proving that the exact XML sent to Python
// contains the Preview and Weight Match facts that were selected.

import { enrichStandaloneDtxrAnnotations } from './xml-cii-standalone-dtxr-enrichment.js';
import { xmlCiiWeightReviewNodeOverrideKey } from '../../converters/xml-cii2019-core/weight-match-model.js';
import { createStandaloneRunParityEvidence } from './xml-cii-run-parity-evidence.js';

const PARITY_MODULE_URL = new URL(
  '../model-converters/converters/xmltocii2019_helper/enrichment-run-parity.js',
  import.meta.url,
);

function text(value) { return value === undefined || value === null ? '' : String(value); }

function parseConfig(raw) {
  try {
    const value = JSON.parse(text(raw) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function localName(node) { return text(node?.localName || node?.nodeName).replace(/^.*:/, ''); }
function elementChildren(parent) {
  return [...(parent?.childNodes || parent?.children || [])]
    .filter((node) => node?.nodeType === undefined || node.nodeType === 1);
}
function childrenByName(parent, name) { return elementChildren(parent).filter((node) => localName(node) === name); }
function firstChild(parent, name) { return childrenByName(parent, name)[0] || null; }
function childText(parent, name) { return text(firstChild(parent, name)?.textContent).trim(); }

function ensureChild(document, parent, name) {
  let element = firstChild(parent, name);
  if (element) return element;
  element = parent?.namespaceURI && typeof document.createElementNS === 'function'
    ? document.createElementNS(parent.namespaceURI, name)
    : document.createElement(name);
  parent.appendChild(element);
  return element;
}

function setChildText(document, parent, name, value) {
  const clean = text(value).trim();
  if (!clean) return false;
  ensureChild(document, parent, name).textContent = clean;
  return true;
}

function numeric(value) {
  const n = Number(text(value).replace(/[^0-9.+-eE]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function recordExpected(entries, {
  scope,
  branchName,
  nodeNumber = '',
  componentRefNo = '',
  endpoint = '',
  position = '',
  path,
  field,
  value,
  kind = 'text',
  source = 'preview',
}) {
  const expected = text(value).trim();
  if (!expected) return;
  entries.push({ scope, branchName, nodeNumber, componentRefNo, endpoint, position, path, field, expected, kind, source });
}

const WEIGHT_BEARING_TYPES = new Set(['FLAN', 'VALV', 'RIGID', 'INST']);

export function mappedNodeWeights(nodeRows, config) {
  const weights = new Map();
  for (const nr of nodeRows || []) {
    // A sentinel -1 is not a unique CII node: 14 PCOM/VALV/FLAN owners
    // share it on GLRD. Never convert an override into "branch|-1" mass.
    if (!WEIGHT_BEARING_TYPES.has(text(nr.componentType).toUpperCase()) ||
        !(Number(nr.nodeNumber)>0)) continue;
    const override = Number(config?.overrides?.rigidWeight?.[nr.key]);
    // Rank/preview candidates are NOT physical-mass authority. Only a
    // persisted explicit Owner override can enter the enriched XML here.
    // Never take a zero-source node's Weight from ranking.best / auto guess.
    const weight = Number.isFinite(override) && override > 0 ? override : null;
    if (weight !== null) weights.set(`${text(nr.branchName)}|${text(nr.nodeNumber)}`, weight);
  }
  return weights;
}

async function applyStandaloneProcessParity(xmlText, config, stagedJsonText, diagnostics) {
  const result = { xmlText, branchRows: [], nodeRows: [], expectedEntries: [], appliedFields: 0 };
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    throw new Error('DOMParser/XMLSerializer is unavailable for standalone run parity enrichment.');
  }
  const { xmlCiiDryRunPreview } = await import('./ui-adapted/xml-cii-adapted-preview-dryrun.js');
  const preview = xmlCiiDryRunPreview(xmlText, config, stagedJsonText || '');
  result.branchRows = Array.isArray(preview?.branchRows) ? preview.branchRows : [];
  result.nodeRows = Array.isArray(preview?.nodeRows) ? preview.nodeRows : [];
  if (!result.branchRows.length) return result;

  const nodeWeights = mappedNodeWeights(result.nodeRows, config);
  const byBranch = new Map(result.branchRows.map((row) => [text(row.branchName), row]));
  const document = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) throw new Error('Standalone run parity could not parse the enriched XML.');

  for (const branch of [...document.getElementsByTagName('Branch')]) {
    const branchName = childText(branch, 'Branchname');
    const row = byBranch.get(branchName);
    if (!row) continue;
    const pressure = ensureChild(document, branch, 'Pressure');
    const temperature = ensureChild(document, branch, 'Temperature');

    const branchWrites = [
      { owner: pressure, name: 'Pressure1', path: ['Pressure', 'Pressure1'], field: 'p1', value: row.p1, kind: 'number' },
      { owner: pressure, name: 'HydroPressure', path: ['Pressure', 'HydroPressure'], field: 'hydroPressure', value: row.hydroPressure, kind: 'number' },
      { owner: temperature, name: 'Temperature1', path: ['Temperature', 'Temperature1'], field: 't1', value: row.t1, kind: 'number' },
      { owner: temperature, name: 'Temperature2', path: ['Temperature', 'Temperature2'], field: 't2', value: row.t2, kind: 'number' },
      { owner: temperature, name: 'Temperature3', path: ['Temperature', 'Temperature3'], field: 't3', value: row.t3, kind: 'number' },
      { owner: branch, name: 'FluidDensity', path: ['FluidDensity'], field: 'density', value: row.density, kind: 'number' },
      { owner: branch, name: 'MaterialNumber', path: ['MaterialNumber'], field: 'materialCode', value: row.materialCode, kind: 'text' },
    ];

    for (const write of branchWrites) {
      const valid = write.kind === 'number' ? numeric(write.value) !== null : text(write.value).trim() !== '';
      if (!valid || !setChildText(document, write.owner, write.name, write.value)) continue;
      result.appliedFields += 1;
      recordExpected(result.expectedEntries, {
        scope: 'branch', branchName, path: write.path, field: write.field,
        value: write.value, kind: write.kind, source: 'standalone-preview',
      });
    }

    for (const node of childrenByName(branch, 'Node')) {
      const nodeNumber = childText(node, 'NodeNumber');
      const nodeWrites = [
        { name: 'PipingClass', field: 'pipingClass', value: row.pipingClass, kind: 'text' },
        { name: 'Rating', field: 'rating', value: row.rating, kind: 'text' },
        { name: 'MaterialName', field: 'material', value: row.material, kind: 'text' },
        { name: 'MaterialCode', field: 'materialCode', value: row.materialCode, kind: 'text' },
        { name: 'WallThickness', field: 'wallThickness', value: row.wallThickness, kind: 'number' },
        { name: 'CorrosionAllowance', field: 'corrosion', value: row.corrosion, kind: 'number' },
      ];
      for (const write of nodeWrites) {
        const valid = write.kind === 'number' ? numeric(write.value) !== null : text(write.value).trim() !== '';
        if (!valid || !setChildText(document, node, write.name, write.value)) continue;
        result.appliedFields += 1;
        recordExpected(result.expectedEntries, {
          scope: 'node', branchName, nodeNumber, path: [write.name], field: write.field,
          value: write.value, kind: write.kind, source: 'standalone-preview',
        });
      }

      const mapped = Number(nodeNumber)>0 ? nodeWeights.get(`${branchName}|${nodeNumber}`) : undefined;
      const existingWeight = numeric(childText(node, 'Weight'));
      if (mapped !== undefined && (existingWeight === null || existingWeight === 0) && setChildText(document, node, 'Weight', mapped)) {
        result.appliedFields += 1;
        recordExpected(result.expectedEntries, {
          scope: 'node', branchName, nodeNumber, path: ['Weight'], field: 'weight',
          value: mapped, kind: 'number', source: 'weight-match',
        });
      }
    }
    // The only legal PCOM write is an exact saved endpoint-2 source key.
    // No fallback to branch|-1, inferred masters, or a neighbouring flange.
    const nodes=childrenByName(branch,'Node');
    const overrides=config?.overrides?.rigidWeight || {};
    const consumed=new Set();
    for(const [nodeIndex,node] of nodes.entries()){
      if(childText(node,'ComponentType').toUpperCase()!=='PCOM' ||
         childText(node,'Endpoint')!=='2')continue;
      const sourceKey=xmlCiiWeightReviewNodeOverrideKey(branchName,node,nodeIndex);
      if(!Object.prototype.hasOwnProperty.call(overrides,sourceKey))continue;
      const saved=Number(overrides[sourceKey]);
      if(!Number.isFinite(saved) || saved<=0)
        throw new Error('CII_PCOM_EXPLICIT_OVERRIDE_INVALID:'+sourceKey);
      const ref=childText(node,'ComponentRefNo');
      const pair=nodes.filter(n=>childText(n,'ComponentType').toUpperCase()==='PCOM' &&
        childText(n,'ComponentRefNo')===ref);
      if(pair.length!==2 || pair.filter(n=>childText(n,'Endpoint')==='1').length!==1 ||
         pair.filter(n=>childText(n,'Endpoint')==='2').length!==1)
        throw new Error('CII_PCOM_SOURCE_PAIR_AMBIGUOUS:'+sourceKey);
      const start=pair.find(n=>childText(n,'Endpoint')==='1');
      if(Number(childText(start,'Weight'))>0)
        throw new Error('CII_PCOM_ENDPOINT1_MASS_CONFLICT:'+sourceKey);
      const existing=numeric(childText(node,'Weight'));
      if(existing!==null && existing>0 && Math.abs(existing-saved)>1e-9)
        throw new Error('CII_PCOM_SOURCE_MASS_CONFLICT:'+sourceKey);
      setChildText(document,node,'Weight',saved);
      result.appliedFields++;
      recordExpected(result.expectedEntries,{
        scope:'node',branchName,nodeNumber:childText(node,'NodeNumber'),
        componentRefNo:ref,endpoint:'2',position:childText(node,'Position'),
        path:['Weight'],field:'weight',value:saved,kind:'number',
        source:'explicit-saved-pcom-owner'
      });
      consumed.add(sourceKey);
    }
    // Explicit PCOM overrides targeting another row of this retained branch
    // must not silently disappear in a run-parity success receipt.
    for(const [key,value] of Object.entries(overrides)){
      if(!key.startsWith(branchName+'::') || !key.endsWith('|PCOM'))continue;
      if(!consumed.has(key))
        throw new Error('CII_PCOM_SAVED_OWNER_NOT_FOUND:'+key);
    }
  }

  if (!result.appliedFields) return result;
  diagnostics.push({
    type: 'standalone-process-parity-applied',
    fields: result.appliedFields,
    message: 'Branch process and node facts were synchronised from the standalone Preview and Weight Match authorities.',
  });
  result.xmlText = new XMLSerializer().serializeToString(document);
  return result;
}

const WEIGHT_MATCH_MODULE_URL = new URL(
  '../model-converters/converters/xmltocii2019_helper/weight-match-renderer.js?v=20261107-glrd-bore-family-r2',
  import.meta.url,
);

export async function loadParentWeightMatchModules() {
  const [renderer, parity] = await Promise.all([
    import(WEIGHT_MATCH_MODULE_URL.href),
    import(PARITY_MODULE_URL.href),
  ]);
  return { bindXmlCiiWeightMatchPhase: renderer.bindXmlCiiWeightMatchPhase, enrichXmlForCii2019: parity.enrichXmlForCii2019 };
}

export function standaloneParityOptions(supportConfigJson, options = {}) {
  const config = parseConfig(supportConfigJson);
  const split = options.splitCondensedValveFlange !== undefined
    ? options.splitCondensedValveFlange !== false
    : (config.splitCondensedValveFlange !== false);
  return {
    supportConfigJson: text(supportConfigJson) || '{}',
    splitCondensedValveFlange: split,
    split_condensed_valve_flange: split,
    condenseRigidXsd: config.condenseRigidXsd === true || config.condense_rigid_xsd === true,
  };
}

export async function enrichStandaloneXmlForRun(job, extraOptions = {}) {
  const sourceText = text(job?.sourceText);
  const out = {
    xmlText: sourceText,
    applied: false,
    diagnostics: [],
    stats: {},
    logs: [],
    error: null,
    evidence: null,
    branchRows: [],
    nodeRows: [],
    expectedEntries: [],
  };
  if (!sourceText.trim()) {
    out.error = 'Standalone run parity requires non-empty XML source text.';
    out.logs.push(`Standalone run parity blocked: ${out.error}`);
    return out;
  }
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    out.error = 'DOMParser/XMLSerializer is unavailable for standalone run parity.';
    out.logs.push(`Standalone run parity blocked: ${out.error}`);
    return out;
  }

  try {
    const parity = await import(PARITY_MODULE_URL.href);
    const options = { ...standaloneParityOptions(job.supportConfigJson, job.options || {}), ...extraOptions };
    const enriched = await parity.enrichXmlForCii2019(sourceText, text(job.stagedJsonText), options);
    const config = parseConfig(options.supportConfigJson);
    const dtxr = enrichStandaloneDtxrAnnotations(enriched.xmlText || sourceText, text(job.stagedJsonText), config);
    out.diagnostics = [
      ...(Array.isArray(enriched.diagnostics) ? enriched.diagnostics : []),
      ...(Array.isArray(dtxr.diagnostics) ? dtxr.diagnostics : []),
    ];
    out.stats = {
      ...(enriched.stats && typeof enriched.stats === 'object' ? enriched.stats : {}),
      ...(dtxr.stats && typeof dtxr.stats === 'object' ? dtxr.stats : {}),
    };

    const process = await applyStandaloneProcessParity(
      dtxr.text || enriched.xmlText || sourceText,
      config,
      text(job.stagedJsonText),
      out.diagnostics,
    );
    out.xmlText = process.xmlText;
    out.branchRows = process.branchRows;
    out.nodeRows = process.nodeRows;
    out.expectedEntries = process.expectedEntries;
    out.evidence = createStandaloneRunParityEvidence({
      xmlText: out.xmlText,
      expectedEntries: out.expectedEntries,
      branchRows: out.branchRows,
      nodeRows: out.nodeRows,
    });
    out.stats.parityComparisons = out.evidence.comparisons;
    out.stats.parityMismatches = out.evidence.mismatchCount;

    if (!out.evidence.ok) {
      out.error = `Standalone run parity blocked ${out.evidence.mismatchCount} authority mismatch(es).`;
      out.logs.push(`${out.error} Engine input was not released.`);
      return out;
    }

    out.applied = true;
    out.logs.push(
      `Standalone run parity PASS (${out.evidence.status}): ${out.evidence.comparisons} comparison(s), input ${out.evidence.engineInputDigest}.`,
    );
    out.logs.push(`Standalone run parity applied: ${out.stats.weightAnnotations || 0} weight annotation(s), ${out.stats.processAnnotations || 0} process annotation(s), ${out.stats.stagedSupportsMapped || 0} staged support(s), ${out.stats.dtxrPosAnnotations || 0} DTXR_POS annotation(s), ${out.stats.dtxrPsAnnotations || 0} DTXR_PS annotation(s), ${out.stats.splitCondensedRigidNodes || 0} renumbered node(s).`);
  } catch (error) {
    out.error = text(error?.message || error);
    out.applied = false;
    out.logs.push(`Standalone run parity blocked: ${out.error}`);
  }
  return out;
}
