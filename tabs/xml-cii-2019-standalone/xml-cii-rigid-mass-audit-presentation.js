/**
 * Presentation-only reconciliation of CII mass ownership findings.
 * Must not weaken the native read-only audit or its fail-closed CII gate.
 */
const num=value=>Number(value);
const flagsOf=row=>Array.isArray(row?.flags)?row.flags:[];

export function explainRigidMassAudit(audit={}) {
  const rows=Array.isArray(audit.rows)?audit.rows:[];
  const flagged=rows.filter(row=>flagsOf(row).length>0);
  const positives=flagged.filter(row=>Number.isFinite(num(row.weightN))&&num(row.weightN)>0);
  const zeros=flagged.filter(row=>num(row.weightN)===0);
  const unownedZeroLinks=zeros.filter(row=>
    flagsOf(row).includes('PHYSICAL_OWNER_UNRESOLVED') &&
    row.fromRef && row.toRef &&
    String(row.fromRef).trim()!==String(row.toRef).trim() &&
    !flagsOf(row).includes('SOURCE_NODE_UNRESOLVED') &&
    !flagsOf(row).includes('CII_SOURCE_GEOMETRY_MISMATCH'));
  const identityGaps=zeros.filter(row=>!unownedZeroLinks.includes(row));
  const allFlags=Array.isArray(audit.flags)?audit.flags:[];
  const advisoryRows=rows.filter(row=>Array.isArray(row.advisories)&&
    row.advisories.includes('ZERO_MASS_INTERCOMPONENT_CONNECTION')&&
    num(row.weightN)===0);
  return {
    elementCount:Number(audit.elementCount)||0,
    auditedPointers:Number(audit.auditedRigidCount)||0,
    flaggedUnique:flagged.length||Number(audit.summary?.flaggedElements)||0,
    policyRevision:String(audit.policyRevision||''),
    flagRecords:allFlags.length,
    zeroWeightCount:zeros.length,
    allZeroWeightCount:rows.filter(row=>num(row.weightN)===0).length,
    positiveWeightCount:positives.length,
    zeroBetweenDistinctRefs:unownedZeroLinks.length,
    zeroNeedsNodeReconciliation:identityGaps.length,
    nonblockingZeroConnections:advisoryRows.length,
    advisoryRecords:Array.isArray(audit.advisories)?audit.advisories.length:0,
    zeroConnectionAdvisories:advisoryRows.map(row=>({
      element:row.element,pointer:row.rigidPointer,weightN:row.weightN,
      lengthMm:row.lengthMm,
      nodes:String(row.from)+' → '+String(row.to),
      fromRef:row.fromRef,toRef:row.toRef,
      reason:'ZERO_MASS_INTERCOMPONENT_CONNECTION',
    })),
    weightedElements:positives.map(row=>({
      element:row.element,pointer:row.rigidPointer,weightN:row.weightN,
      nodes:String(row.from)+' → '+String(row.to),reasons:flagsOf(row),
    })),
    engineeringMassVerified:false,
    releasePolicy:'UNCHANGED_FAIL_CLOSED',
  };
}
