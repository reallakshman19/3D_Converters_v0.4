import { createEmpiricalWeightEstimator } from '../empirical-weight/index.js';

// Diagnostic only. No empirical result is accepted as physical mass authority.
const norm = (v) => String(v ?? '').trim();
const refKey = (v) => norm(v).replace(/^=/, '').replace(/\s+/g, '').toUpperCase();
const finite = (v) => v === '' || v == null ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
const positive = (v) => finite(v) !== null && Number(v) > 0 ? Number(v) : null;
const tokens = (v) => norm(v).split(/\s+/).filter(Boolean);
const numbers = (v) => String(v ?? '').match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/g) || []; // CII fields may touch at a minus sign
const equal = (a, b) => Math.abs(a - b) <= Math.max(0.01, Math.abs(a) * 1e-5);
const vec = (a,b) => a.map((v,i)=>v-b[i]);
const dot = (a,b) => a.reduce((sum,v,i)=>sum+v*b[i],0);
const len = (a,b) => Math.hypot(...vec(a,b));
const keyRef = (branch, ref) => branch + '\u0000' + refKey(ref);
const keyNode = (branch, node) => branch + '\u0000' + node;
// Fast accidental-staleness guard; NOT a cryptographic source/engineering proof.
function ciiFingerprint(value) {
  const content=String(value??'');
  let hash=2166136261;
  for(let i=0;i<content.length;i++)hash=Math.imul(hash^content.charCodeAt(i),16777619);
  return (hash>>>0).toString(16).padStart(8,'0')+':'+content.length;
}

function positiveInteriorOverlap(a,b,start,end,toleranceMm=0.2) {
  const span=vec(end,start), L=Math.hypot(...span);
  if (!(L>0))return 0;
  const axis=span.map(x=>x/L), va=vec(a,start), vb=vec(b,start);
  const pa=dot(va,axis), pb=dot(vb,axis);
  if(Math.hypot(...vec(va,axis.map(x=>x*pa)))>toleranceMm ||
     Math.hypot(...vec(vb,axis.map(x=>x*pb)))>toleranceMm)return 0;
  return Math.max(0, Math.min(L,Math.max(pa,pb))-Math.max(0,Math.min(pa,pb)));
}
function groupSourceComponents(source) {
  const byRef=new Map();
  for(const row of source) {
    if(!refKey(row.ref))continue;
    const k=keyRef(row.branch,row.ref);
    if(!byRef.has(k))byRef.set(k,[]);
    byRef.get(k).push(row);
  }
  return [...byRef.entries()].map(([key,records])=>{
    const starts=records.filter(r=>r.endpoint===1&&Array.isArray(r.position));
    const ends=records.filter(r=>r.endpoint===2&&Array.isArray(r.position));
    const massValues=[...new Set(records.map(r=>positive(r.weightKg)).filter(Boolean))];
    return {key,branch:records[0].branch,ref:records[0].ref,records,
      start:starts.length===1?starts[0]:null,end:ends.length===1?ends[0]:null,
      massKg:massValues.length===1?massValues[0]:null,
      massConflict:massValues.length>1,massMissing:massValues.length===0,
      explicitZeroMass:massValues.length===0&&records.every(r=>r.weightKg===0),
      ambiguous:starts.length!==1||ends.length!==1};
  });
}
function groupEmpiricalRequest(group) {
  if(!group||!group.records.some(r=>['FLAN','RIGID'].includes(r.componentType)))return null;
  const evidence=group.records.find(r=>/WELD(?:ING)?\s*NECK\s*FLANGE/i.test(r.dtxr||''));
  if(!evidence||!positive(evidence.dn)||!positive(evidence.rating))return null;
  return {typeDesc:'Weldneck Flange',dn:evidence.dn,rating:evidence.rating,target:'RF/RTJ KG'};
}
function empiricalForGroup(group,estimator) {
  const request=groupEmpiricalRequest(group);
  if(!request)return {status:'API_NOT_APPLICABLE_OR_MISSING_INPUT'};
  try {
    const result=estimator.estimate(request);
    return result?.ok
      ? {status:'API_ESTIMATE',weightKg:result.weightKg,modelId:result.modelId,
         approach:result.approach,confidence:result.confidence}
      : {status:'API_UNAVAILABLE',code:result?.error?.code||'UNKNOWN'};
  }catch{return {status:'API_UNAVAILABLE',code:'EMPIRICAL_ESTIMATOR_FAILED'};}
}

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
    if (fields.length !== 2 || finite(fields[0]) === null || Number(fields[0]) < 0 || finite(fields[1]) === null)
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
    if (geom.length !== 6 || geom.some(x=>!Number.isFinite(Number(x))) ||
        ![geom[0],geom[1]].every(x=>Number.isSafeInteger(Number(x))) ||
        ints.length !== 6 || !ints.every(x=>Number.isSafeInteger(Number(x))) ||
        !Number.isSafeInteger(pointer) || pointer < 0 || pointer > rigidCount)
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
      dx:delta[0],dy:delta[1],dz:delta[2],
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

function xmlPosition(value) {
  const fields=tokens(value).map(Number);
  return fields.length===3&&fields.every(Number.isFinite)?fields:null;
}
export function extractXmlRigidAuditRows(xmlText) {
  if (typeof DOMParser === 'undefined') throw new Error('XML_DOM_PARSER_UNAVAILABLE');
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML_PARSE_FAILED');
  const result = [];
  for (const branch of [...doc.getElementsByTagNameNS('*', 'Branch')]) {
    const branchName = child(branch, 'Branchname');
    for (const [ordinal,node] of [...branch.children].filter((x) => x.localName === 'Node').entries()) {
      result.push({
        branch: branchName, ordinal,
        nodeNumber: finite(child(node, 'NodeNumber')),
        position: xmlPosition(child(node, 'Position')),
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
  if(!result.length)throw Error('XML_COMPONENT_POPULATION_EMPTY');
  return result;
}

/**
 * Read-only actual-CII-to-source audit. Every numeric CII weight is resolved
 * from ELEMENTS -> pointer -> RIGID, never from an XML node as a substitute.
 * The empirical estimator is evidence for a recognized physical family only.
 */
export function auditRigidWeightOwnership({ciiText,xmlRows,estimator,kgToNewtonScale=10}={}) {
  if(!(finite(kgToNewtonScale)>0))throw Error('WEIGHT_SCALE_INVALID');
  const parsed=parseCiiRigidElementWeights(ciiText);
  const source=Array.isArray(xmlRows)?xmlRows:[];
  if(!source.length)throw Error('XML_COMPONENT_POPULATION_EMPTY');
  const byNode=new Map();
  for(const s of source) {
    if(!Number.isSafeInteger(s.nodeNumber)||s.nodeNumber<=0)continue;
    const k=keyNode(s.branch,s.nodeNumber);
    if(!byNode.has(k))byNode.set(k,[]);
    byNode.get(k).push(s);
  }
  const groups=groupSourceComponents(source);
  const byRef=new Map(groups.map(g=>[g.key,g]));
  const effectiveEstimator=estimator||createEmpiricalWeightEstimator();
  const apiCache=new Map();
  const rows=parsed.elements.filter(e=>e.rigidPointer>0).map(edge=>{
    const a=byNode.get(keyNode(edge.branch,edge.from))||[];
    const b=byNode.get(keyNode(edge.branch,edge.to))||[];
    const from=a.length===1?a[0]:null,to=b.length===1?b[0]:null,flags=[];
    // Final CII can renumber original XML NodeNumber=-1 when the converter
    // splits/cleans a component. A generated CII number is NOT a source
    // ComponentRefNo. Recover the missing coordinate only when exactly one
    // opposite endpoint has authentic source geometry, then qualify against
    // a UNIQUE complete physical component span in the original XML.
    const delta=[edge.dx,edge.dy,edge.dz];
    let fromPosition=from?.position||null,toPosition=to?.position||null;
    let geometricRecovery='NONE';
    if(fromPosition&&!toPosition&&b.length===0){
      toPosition=fromPosition.map((x,i)=>x+delta[i]);
      geometricRecovery='CII_TO_FROM_AUTHENTIC_SOURCE_FROM';
    }else if(toPosition&&!fromPosition&&a.length===0){
      fromPosition=toPosition.map((x,i)=>x-delta[i]);
      geometricRecovery='CII_FROM_FROM_AUTHENTIC_SOURCE_TO';
    }
    if(!fromPosition||!toPosition) flags.push('SOURCE_NODE_UNRESOLVED');
    if(fromPosition&&toPosition&&Math.abs(len(fromPosition,toPosition)-edge.lengthMm)>0.25)
      flags.push('CII_SOURCE_GEOMETRY_MISMATCH');
    const recovered=geometricRecovery!=='NONE';
    const matches=flags.length?[]:groups.map(group=>{
      if(group.branch!==edge.branch||!group.start||!group.end)return null;
      if(recovered){
        // Reject geometric proximity without exact physical endpoint custody.
        // Connections between unlike source refs and partial overlaps do NOT
        // acquire a physical owner merely through collinear CII geometry.
        const known=from||to;
        if(!known?.ref||refKey(known.ref)!==refKey(group.ref))return null;
        const forward=len(fromPosition,group.start.position)<=0.25&&
          len(toPosition,group.end.position)<=0.25;
        const reverse=len(fromPosition,group.end.position)<=0.25&&
          len(toPosition,group.start.position)<=0.25;
        if(!forward&&!reverse)return null;
      }
      const overlap=positiveInteriorOverlap(fromPosition,toPosition,group.start.position,group.end.position);
      if(overlap<=0.2)return null;
      const span=len(group.start.position,group.end.position);
      return overlap>=0.5*Math.min(edge.lengthMm,span)?{group,overlap}:null;
    }).filter(Boolean);
    // A reconstructed coordinate is not a recovered SOURCE node. It may
    // replace SOURCE_NODE_UNRESOLVED only after a unique original physical
    // component with both authentic endpoints is independently established.
    if(recovered&&matches.length!==1)flags.push('SOURCE_NODE_UNRESOLVED');
    if(matches.length>1)flags.push('PHYSICAL_OWNER_AMBIGUOUS');
    const hit=matches.length===1?matches[0]:null;
    const group=hit?.group||null;
    if(!group)flags.push('PHYSICAL_OWNER_UNRESOLVED');
    if(group?.ambiguous)flags.push('SOURCE_COMPONENT_OCCURRENCE_AMBIGUOUS');
    if(group?.massConflict)flags.push('SOURCE_ENDPOINT_WEIGHTS_CONFLICT');
    if(group?.explicitZeroMass&&edge.weightN>0)flags.push('POSITIVE_WEIGHT_ON_ZERO_MASS_COMPONENT');
    else if(group?.massMissing&&!group?.explicitZeroMass)flags.push('SOURCE_COMPONENT_MASS_UNRESOLVED');
    // A zero-weight connector BETWEEN two authentic, distinctly referenced
    // source components is not itself evidence of an omitted physical mass.
    // Treat this narrowly as an identity advisory: never for a positive weight,
    // generated/missing source node, geometry mismatch, ambiguous mapping, or
    // when ANY other audit flag is present. Do not fabricate a physical owner.
    const zeroIntercomponentLink=edge.weightN===0&&edge.lengthMm>0&&
      !group&&matches.length===0&&from&&to&&
      refKey(from.ref)&&refKey(to.ref)&&refKey(from.ref)!==refKey(to.ref)&&
      geometricRecovery==='NONE'&&Array.isArray(fromPosition)&&
      Array.isArray(toPosition)&&flags.length===1&&
      flags[0]==='PHYSICAL_OWNER_UNRESOLVED';
    const advisories=zeroIntercomponentLink?['ZERO_MASS_INTERCOMPONENT_CONNECTION']:[];
    if(zeroIntercomponentLink)flags.pop();
    let empirical={status:'API_NOT_APPLICABLE_CONNECTION'};
    if(group&&!group.explicitZeroMass) {
      if(!apiCache.has(group.key))apiCache.set(group.key,empiricalForGroup(group,effectiveEstimator));
      empirical=apiCache.get(group.key);
    }
    return {...edge,
      fromRef:from?.ref||null,toRef:to?.ref||null,
      fromPosition:fromPosition||null,toPosition:toPosition||null,
      sourceNodeGeometryRecovery:recovered
        ? (group?'UNIQUE_ORIGINAL_COMPONENT_SPAN_CONFIRMED':'POSITION_RECONSTRUCTED_OWNER_UNRESOLVED')
        : 'NOT_NEEDED',
      sourceGeneratedEndpoint:recovered?(from?'TO':'FROM'):null,
      physicalComponentRef:group?.ref||null,physicalComponentKey:group?.key||null,
      ownerType:group?.end?.componentType||group?.start?.componentType||null,
      ownerSpanMm:group?.start&&group?.end?len(group.start.position,group.end.position):null,
      sourceOverlapMm:hit?.overlap??0,
      approvedSourceMassKg:null,sourceMassCandidateKg:group?.massKg??null,
      massAuthority:group?.massConflict?'CONFLICT':group?.explicitZeroMass?'XML_EXPLICIT_ZERO':
        group?.massMissing?'UNRESOLVED':group?'XML_CONSISTENT_UNAPPROVED':'NO_OWNER',
      ownership:zeroIntercomponentLink?'ZERO_WEIGHT_INTERCOMPONENT_LINK':
        group?'GEOMETRIC_INTERIOR_OVERLAP':'UNRESOLVED',
      allocationBasis:zeroIntercomponentLink?'AUTHENTIC_DISTINCT_SOURCE_REFS_NO_PHYSICAL_SPAN':
        group?'CII_ELEMENT_OVERLAP_XML_COMPONENT_SPAN':'NO_SOURCE_COMPONENT_INTERIOR_OVERLAP',
      empirical,flags,advisories};
  });
  for(const row of rows) {
    if(!(row.weightN>0)||!row.toRef||
       (row.physicalComponentRef&&row.massAuthority!=='XML_EXPLICIT_ZERO'))continue;
    const next=rows.find(x=>x.branch===row.branch&&x.from===row.to&&x.physicalComponentRef&&
      refKey(x.physicalComponentRef)===refKey(row.toRef));
    const group=byRef.get(keyRef(row.branch,row.toRef));
    if(next&&group?.massKg!==null&&!group?.massConflict&&
       equal(row.weightN,group.massKg*kgToNewtonScale)&&
       equal(next.weightN,group.massKg*kgToNewtonScale)) {
      row.flags.push('DUPLICATE_FULL_COMPONENT_MASS_ON_CONNECTION');
      row.duplicatedWithElement=next.element;
    }else if(!row.physicalComponentRef)
      row.flags.push('WEIGHTED_CONNECTION_WITHOUT_PHYSICAL_OWNER');
    // Known zero-mass owner already has POSITIVE_WEIGHT_ON_ZERO_MASS_COMPONENT.
    // Do not falsely claim it has NO physical owner unless the source mapping
    // is genuinely absent. The GLRD adjacent-flange duplicate check above
    // remains mandatory for mapped zero-mass PCOMs.
  }
  for(const group of groups) {
    const children=rows.filter(row=>row.physicalComponentKey===group.key);
    if(!children.length||group.massConflict||group.massMissing)continue;
    const total=children.reduce((sum,row)=>sum+row.weightN,0);
    if(!equal(total,group.massKg*kgToNewtonScale))
      for(const child of children)child.flags.push('PHYSICAL_COMPONENT_MASS_NOT_CONSERVED');
  }
  const asFinding=(row,code)=>({
    element:row.element,branch:row.branch,from:row.from,to:row.to,
    rigidPointer:row.rigidPointer,weightN:row.weightN,lengthMm:row.lengthMm,
    physicalComponentRef:row.physicalComponentRef,fromRef:row.fromRef,toRef:row.toRef,code});
  const flags=rows.flatMap(row=>[...new Set(row.flags)].map(code=>asFinding(row,code)));
  const advisories=rows.flatMap(row=>[...new Set(row.advisories||[])].map(code=>asFinding(row,code)));
  return {schema:'xml-cii2019-rigid-empirical-ownership-audit/v2',
    authority:'READ_ONLY_NOT_MASS_ALLOCATION_OR_RELEASE_AUTHORITY',
    massVerified:false,ciiFingerprint:ciiFingerprint(ciiText),
    elementCount:parsed.elementCount,rigidCount:parsed.rigidCount,
    auditedRigidCount:rows.length,
    summary:{flaggedElements:new Set(flags.map(f=>f.element)).size,
      flagsByCode:Object.fromEntries([...new Set(flags.map(f=>f.code))].sort().map(
        code=>[code,flags.filter(f=>f.code===code).length])),
      advisoryElements:new Set(advisories.map(f=>f.element)).size,
      advisoriesByCode:Object.fromEntries([...new Set(advisories.map(f=>f.code))].sort().map(
        code=>[code,advisories.filter(f=>f.code===code).length]))},
    flags,advisories,rows,status:flags.length?'HOLD':'SOURCE_PARITY_ONLY_NOT_MASS_AUTHORITY'};
}

export function auditRigidWeightFromXml({ ciiText, xmlText, weightMasterRows, estimator, kgToNewtonScale = 10 } = {}) {
  let resolvedEstimator = estimator;
  if (!resolvedEstimator) {
    try {
      resolvedEstimator = createEmpiricalWeightEstimator(
        Array.isArray(weightMasterRows) && weightMasterRows.length ? { masterRows: weightMasterRows } : undefined);
    } catch {
      resolvedEstimator = { estimate: () => ({ ok: false, error: { code: 'EMPIRICAL_MASTER_UNAVAILABLE' } }) };
    }
  }
  return auditRigidWeightOwnership({
    ciiText,
    xmlRows: extractXmlRigidAuditRows(xmlText),
    estimator: resolvedEstimator,
    kgToNewtonScale,
  });
}

/** Fail-closed output gate. A clean source parity check is not engineering mass approval. */
export function holdDuplicateRigidMassOutput(output,audit) {
  // A changed status or empty top-level flags cannot wash out flagged child rows.
  // A missing/partial/contradictory evidence object is never a qualified result.
  const isQualifiedZeroConnector=row=>
    row.weightN===0&&row.lengthMm>0&&
    row.ownership==='ZERO_WEIGHT_INTERCOMPONENT_LINK'&&
    row.allocationBasis==='AUTHENTIC_DISTINCT_SOURCE_REFS_NO_PHYSICAL_SPAN'&&
    row.massAuthority==='NO_OWNER'&&row.physicalComponentRef===null&&
    row.physicalComponentKey===null&&row.sourceOverlapMm===0&&
    row.sourceNodeGeometryRecovery==='NOT_NEEDED'&&
    Array.isArray(row.fromPosition)&&Array.isArray(row.toPosition)&&
    refKey(row.fromRef)&&refKey(row.toRef)&&
    refKey(row.fromRef)!==refKey(row.toRef)&&
    Array.isArray(row.advisories)&&row.advisories.length===1&&
    row.advisories[0]==='ZERO_MASS_INTERCOMPONENT_CONNECTION';
  const evidenceRowsValid=Array.isArray(audit?.rows)&&
    audit.rows.length===audit.rigidCount&&
    audit.rows.every(row=>Array.isArray(row.flags)&&row.flags.length===0&&
      Number.isSafeInteger(row.rigidPointer)&&row.rigidPointer>0&&
      Number.isFinite(row.weightN)&&row.weightN>=0&&
      (isQualifiedZeroConnector(row) ||
       (row.ownership==='GEOMETRIC_INTERIOR_OVERLAP'&&
        (row.massAuthority==='XML_CONSISTENT_UNAPPROVED' ||
         (row.massAuthority==='XML_EXPLICIT_ZERO' && row.weightN===0))&&
        (!Array.isArray(row.advisories)||row.advisories.length===0))));
  const summaryClean=audit?.summary?.flaggedElements===0&&
    audit?.summary?.flagsByCode&&Object.keys(audit.summary.flagsByCode).length===0;
  // A warning is not a shortcut around verification: each advisory must
  // exactly match an audited zero-connector row. No unlabeled advisory class
  // may silently become release-eligible.
  const warningRows=Array.isArray(audit?.rows)
    ?audit.rows.filter(row=>Array.isArray(row.advisories)&&row.advisories.length>0):[];
  const advisoriesValid=Array.isArray(audit?.advisories)&&
    audit.advisories.length===warningRows.length&&
    warningRows.every(row=>isQualifiedZeroConnector(row)&&
      audit.advisories.some(a=>a.element===row.element&&a.rigidPointer===row.rigidPointer&&
        a.weightN===0&&a.code==='ZERO_MASS_INTERCOMPONENT_CONNECTION'&&
        refKey(a.fromRef)===refKey(row.fromRef)&&refKey(a.toRef)===refKey(row.toRef)))&&
    audit?.summary?.advisoryElements===warningRows.length&&
    audit?.summary?.advisoriesByCode&&
    Object.values(audit.summary.advisoriesByCode).reduce((n,v)=>n+v,0)===warningRows.length;
  const complete=typeof output?.ciiText==='string'&&output.ciiText.length>0&&
    audit?.ciiFingerprint===ciiFingerprint(output.ciiText)&&
    audit?.schema==='xml-cii2019-rigid-empirical-ownership-audit/v2'&&
    audit.auditedRigidCount===audit.rigidCount&&audit.massVerified===false&&
    audit.status==='SOURCE_PARITY_ONLY_NOT_MASS_AUTHORITY'&&
    Array.isArray(audit.flags)&&audit.flags.length===0&&
    evidenceRowsValid&&summaryClean&&advisoriesValid;
  const diagnostics={...(output?.diagnostics||{}),rigidMassAudit:audit||{
    schema:'xml-cii2019-rigid-empirical-ownership-audit/v2',status:'NOT_RUN',massVerified:false},
    rigidMassEngineeringQualified:false};
  if(complete)return {...output,diagnostics,logs:[...(output?.logs||[]),'RIGID_MASS_SOURCE_PARITY_ONLY_NOT_ENGINEERING_APPROVED']};
  const error='RIGID_MASS_CONSERVATION_HOLD';
  // A structurally parsed, fingerprint-matched, FLAGGED CII may be held in
  // isolated review-only custody. Never put it back in the ordinary output
  // artifact field, report ok=true, or treat edits as engineering release.
  // Missing/failed/untrusted audit evidence does NOT qualify for repair view.
  const repairable=typeof output?.ciiText==='string'&&output.ciiText.length>0&&
    audit?.schema==='xml-cii2019-rigid-empirical-ownership-audit/v2'&&
    audit.status==='HOLD'&&Array.isArray(audit.flags)&&audit.flags.length>0&&
    audit.flags.every(f=>Number.isSafeInteger(f.rigidPointer)&&f.rigidPointer>0&&
      Number.isSafeInteger(f.element)&&f.element>0)&&
    Array.isArray(audit.rows)&&audit.rows.length===audit.auditedRigidCount&&
    audit.auditedRigidCount===audit.rigidCount&&audit.rigidCount>0&&
    audit.ciiFingerprint===ciiFingerprint(output.ciiText);
  const rigidMassRepairCandidate=repairable?{
    status:'QUARANTINED_REVIEW_ONLY',
    ciiText:output.ciiText,
    ciiName:output.ciiName||'held-rigid-weights.cii',
    sourceCiiFingerprint:audit.ciiFingerprint,
    engineeringReleaseAuthorized:false,
    massAuthority:'NOT_VERIFIED_SOURCE_AUDIT_HOLD',
  }:null;
  return {...output,ok:false,error,ciiText:'',ciiName:'',
    rigidMassRepairCandidate,
    diagnostics:{...diagnostics,rigidMassCiiReleaseAuthorized:false},
    logs:[...(output?.logs||[]),error]};
}
