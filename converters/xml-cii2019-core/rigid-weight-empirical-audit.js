import { createEmpiricalWeightEstimator } from '../empirical-weight/index.js';

// Diagnostic only. No empirical result is accepted as physical mass authority.
const norm = (v) => String(v ?? '').trim();
const refKey = (v) => norm(v).replace(/^=/, '').replace(/\s+/g, '').toUpperCase();
const finite = (v) => v === '' || v == null ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
const positive = (v) => finite(v) !== null && Number(v) > 0 ? Number(v) : null;
const tokens = (v) => norm(v).split(/\s+/).filter(Boolean);
const numbers = (v) => String(v ?? '').match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/g) || []; // CII fields may touch at a minus sign
const equal = (a, b) => Math.abs(a - b) <= Math.max(0.01, Math.abs(a) * 1e-5);

export function parseCiiRigidElementWeights(ciiText) {
  const sections = new Map();
  let section = null;
  for (const line of String(ciiText ?? '').split(/\r?\n/)) {
    if (/^#\$\s+/.test(line)) {
      section = line.replace(/^#\$\s+/, '').trim();
      if (sections.has(section)) throw new Error(`CII_DUPLICATE_SECTION:${section}`);
      sections.set(section, []);
    } else if (section !== null && line.trim()) sections.get(section).push(line);
  }
  for (const name of ['CONTROL', 'ELEMENTS', 'RIGID']) {
    if (!sections.has(name)) throw new Error(`CII_MISSING_SECTION:${name}`);
  }
  const control = sections.get('CONTROL');
  const elementCount = Number(tokens(control[0])[0]);
  const rigidCount = Number(tokens(control[1])[1]);
  if (!Number.isSafeInteger(elementCount) || elementCount < 0 || !Number.isSafeInteger(rigidCount) || rigidCount < 0)
    throw new Error('CII_CONTROL_INVALID');
  const elementRows = sections.get('ELEMENTS');
  const rigidRows = sections.get('RIGID');
  if (elementRows.length !== elementCount * 15 || rigidRows.length !== rigidCount)
    throw new Error('CII_RECORD_COUNT_MISMATCH');
  const weights = rigidRows.map((line) => {
    const fields = tokens(line);
    if (fields.length !== 2 || finite(fields[0]) === null || Number(fields[0]) < 0)
      throw new Error('CII_RIGID_WEIGHT_INVALID');
    return Number(fields[0]);
  });
  const usedPointers = new Set();
  const elements = [];
  for (let i = 0; i < elementCount; i++) {
    const b = elementRows.slice(i * 15, (i + 1) * 15);
    const geom = numbers(b[0]);
    const ints = tokens(b[12]);
    const pointer = Number(ints[1]);
    if (geom.length !== 6 || ints.length !== 6 || !Number.isSafeInteger(pointer) || pointer < 0 || pointer > rigidCount)
      throw new Error(`CII_ELEMENT_INVALID:${i + 1}`);
    if (pointer && usedPointers.has(pointer)) throw new Error('CII_RIGID_POINTER_DUPLICATE');
    if (pointer) usedPointers.add(pointer);
    const delta = geom.slice(2, 5).map(Number);
    if (delta.some((x) => !Number.isFinite(x))) throw new Error('CII_ELEMENT_GEOMETRY_INVALID');
    const branch = norm(b[10]).replace(/^\d+\s+/, '');
    elements.push({
      element: i + 1,
      branch,
      from: Number(geom[0]),
      to: Number(geom[1]),
      lengthMm: Math.hypot(...delta),
      rigidPointer: pointer,
      weightN: pointer ? weights[pointer - 1] : 0,
    });
  }
  if (usedPointers.size !== rigidCount) throw new Error('CII_RIGID_POINTER_ORPHAN');
  return { elements, elementCount, rigidCount };
}

function child(node, tag) {
  return [...(node?.children || [])].find((x) => x.localName === tag)?.textContent?.trim() || '';
}

export function extractXmlRigidAuditRows(xmlText) {
  if (typeof DOMParser === 'undefined') throw new Error('XML_DOM_PARSER_UNAVAILABLE');
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML_PARSE_FAILED');
  const result = [];
  for (const branch of [...doc.getElementsByTagNameNS('*', 'Branch')]) {
    const branchName = child(branch, 'Branchname');
    for (const node of [...branch.children].filter((x) => x.localName === 'Node')) {
      result.push({
        branch: branchName,
        nodeNumber: finite(child(node, 'NodeNumber')),
        ref: child(node, 'ComponentRefNo'),
        endpoint: finite(child(node, 'Endpoint')),
        componentType: child(node, 'ComponentType').toUpperCase(),
        weightKg: finite(child(node, 'Weight')),
        rating: positive(child(node, 'Rating')),
        dn: positive(child(node, 'BoreMm')),
        dtxr: child(node, 'DTXR_POS'),
      });
    }
  }
  return result;
}

function empiricalRequest(row) {
  // The repository API has model families for valve/flange devices, not PCOM or pipe metal.
  if (row?.componentType !== 'FLAN' && row?.componentType !== 'RIGID') return null;
  if (!/WELD(?:ING)?\s*NECK\s*FLANGE/i.test(row.dtxr || '')) return null;
  if (!positive(row.dn) || !positive(row.rating)) return null;
  return { typeDesc: 'Weldneck Flange', dn: row.dn, rating: row.rating, target: 'RF/RTJ KG' };
}

/**
 * Read-only actual-CII-to-source audit. Every numeric CII weight is resolved
 * from ELEMENTS -> pointer -> RIGID, never from an XML node as a substitute.
 * The empirical estimator is evidence for a recognized physical family only.
 */
export function auditRigidWeightOwnership({ ciiText, xmlRows, estimator, kgToNewtonScale = 10 }) {
  const parsed = parseCiiRigidElementWeights(ciiText);
  const source = Array.isArray(xmlRows) ? xmlRows : [];
  const byNumber = new Map();
  const byRef = new Map();
  for (const row of source) {
    const key = `${row.branch}\u0000${row.nodeNumber}`;
    if (positive(row.nodeNumber)) byNumber.set(key, [...(byNumber.get(key) || []), row]);
    const ref = refKey(row.ref);
    if (ref) {
      const refId = `${row.branch}\u0000${ref}`;
      byRef.set(refId, [...(byRef.get(refId) || []), row]);
    }
  }
  const rows = parsed.elements.filter((item) => item.rigidPointer > 0).map((edge) => {
    const fromRows = byNumber.get(`${edge.branch}\u0000${edge.from}`) || [];
    const toRows = byNumber.get(`${edge.branch}\u0000${edge.to}`) || [];
    const from = fromRows.length === 1 ? fromRows[0] : null;
    const to = toRows.length === 1 ? toRows[0] : null;
    const sameComponent = Boolean(from && to && refKey(from.ref) && refKey(from.ref) === refKey(to.ref));
    return {
      ...edge,
      fromRef: from?.ref || null,
      toRef: to?.ref || null,
      toEndpoint: to?.endpoint ?? null,
      toComponentType: to?.componentType || null,
      sourceWeightKg: to?.weightKg ?? null,
      physicalComponentRef: sameComponent ? to.ref : null,
      ownership: !from || !to ? 'SOURCE_NODE_UNRESOLVED'
        : sameComponent ? 'SAME_PHYSICAL_COMPONENT'
        : to.endpoint === 1 ? 'CONNECTION_TO_COMPONENT_START' : 'CROSSES_COMPONENT_BOUNDARY',
      empirical: null,
      flags: [],
      _to: to,
    };
  });
  for (const row of rows) {
    if (row.ownership === 'CONNECTION_TO_COMPONENT_START' && row.weightN > 0) {
      const following = rows.find((next) =>
        next.branch === row.branch && next.from === row.to &&
        next.ownership === 'SAME_PHYSICAL_COMPONENT' && next.physicalComponentRef &&
        refKey(next.physicalComponentRef) === refKey(row.toRef) && next.weightN > 0);
      const group = byRef.get(`${row.branch}\u0000${refKey(row.toRef)}`) || [];
      const masses = [...new Set(group.map((x) => positive(x.weightKg)).filter(Boolean))];
      const sourceKg = masses.length === 1 ? masses[0] : null;
      if (following && sourceKg !== null && equal(row.weightN, sourceKg * kgToNewtonScale)
          && equal(following.weightN, sourceKg * kgToNewtonScale)) {
        row.flags.push('DUPLICATE_FULL_COMPONENT_MASS_ON_CONNECTION');
        row.duplicatedWithElement = following.element;
      } else {
        row.flags.push('WEIGHTED_CONNECTION_REQUIRES_INDEPENDENT_OWNER');
      }
    }
    if (row.ownership === 'SAME_PHYSICAL_COMPONENT') {
      const group = byRef.get(`${row.branch}\u0000${refKey(row.physicalComponentRef)}`) || [];
      const positiveWeights = [...new Set(group.map((x) => positive(x.weightKg)).filter(Boolean))];
      if (positiveWeights.length > 1) row.flags.push('SOURCE_ENDPOINT_WEIGHTS_CONFLICT');
      const request = empiricalRequest(row._to);
      if (request) {
        const result = (estimator || createEmpiricalWeightEstimator()).estimate(request);
        row.empirical = result?.ok
          ? { status: 'API_ESTIMATE', weightKg: result.weightKg, modelId: result.modelId, approach: result.approach, confidence: result.confidence }
          : { status: 'API_UNAVAILABLE', code: result?.error?.code || 'UNKNOWN' };
      } else {
        row.empirical = { status: 'API_NOT_APPLICABLE_OR_MISSING_INPUT' };
      }
    } else if (row.ownership === 'CONNECTION_TO_COMPONENT_START') {
      row.empirical = { status: 'API_NOT_APPLICABLE_CONNECTION' };
    }
    delete row._to;
  }
  const flags = rows.flatMap((row) => row.flags.map((code) => ({ element: row.element, from: row.from, to: row.to, code })));
  return {
    schema: 'xml-cii2019-rigid-empirical-ownership-audit/v1',
    authority: 'READ_ONLY_NOT_MASS_ALLOCATION_OR_RELEASE_AUTHORITY',
    elementCount: parsed.elementCount,
    rigidCount: parsed.rigidCount,
    flags,
    rows,
    status: flags.length ? 'REVIEW_REQUIRED' : 'NO_FLAGGED_WEIGHT_OWNERSHIP',
  };
}

export function auditRigidWeightFromXml({ ciiText, xmlText, weightMasterRows, estimator } = {}) {
  const resolvedEstimator = estimator || createEmpiricalWeightEstimator(
    Array.isArray(weightMasterRows) && weightMasterRows.length ? { masterRows: weightMasterRows } : undefined);
  return auditRigidWeightOwnership({
    ciiText,
    xmlRows: extractXmlRigidAuditRows(xmlText),
    estimator: resolvedEstimator,
  });
}

/** Withhold actual CII bytes when a complete source component mass is duplicated. */
export function holdDuplicateRigidMassOutput(output, audit) {
  const hasDuplicate = (audit?.flags || []).some((row) => row.code === 'DUPLICATE_FULL_COMPONENT_MASS_ON_CONNECTION');
  const diagnostics = { ...(output?.diagnostics || {}), rigidMassAudit: audit };
  if (!hasDuplicate) return { ...output, diagnostics };
  const error = 'RIGID_MASS_CONSERVATION_HOLD';
  return {
    ...output,
    ok: false,
    error,
    ciiText: '',
    ciiName: '',
    diagnostics: { ...diagnostics, rigidMassCiiReleaseAuthorized: false },
    logs: [...(output?.logs || []), error],
  };
}
