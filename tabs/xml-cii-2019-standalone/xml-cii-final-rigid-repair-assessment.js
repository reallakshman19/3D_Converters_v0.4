/**
 * Read-only prioritisation of final emitted RIGID pointer mass problems.
 * A short route length is a REVIEW SIGNAL only, never a physical component
 * identity or basis for a mass calculation.
 *
 * Source ownership flags come only from the native CII-to-XML rigid audit.
 * Catalog reference score and CII OD/branch metadata cannot approve mass.
 */
const positive=(value)=>Number.isFinite(Number(value))&&Number(value)>0;
const unique=(items)=>[...new Set(items)];
export const FINAL_RIGID_SHORT_SPAN_REVIEW_MM=25;

export function buildFinalRigidRepairAssessments(inventory={},plans=[],audit=null,options={}) {
  const limit=Number(options.shortSpanReviewMm??FINAL_RIGID_SHORT_SPAN_REVIEW_MM);
  if(!Number.isFinite(limit)||limit<=0||limit>1000)
    throw new Error('Invalid short-span REVIEW limit; no geometric mass authority');
  const rows=Array.isArray(inventory.rows)?inventory.rows:[];
  const actualAudit= audit?.schema==='xml-cii2019-rigid-empirical-ownership-audit/v2'
    && audit.status==='HOLD' && Array.isArray(audit.flags) ? audit : null;
  const flaggedByPointer=new Map();
  for(const flag of actualAudit?.flags||[]){
    const pointer=Number(flag.rigidPointer);
    if(!Number.isSafeInteger(pointer)||pointer<1||pointer>rows.length)continue;
    const list=flaggedByPointer.get(pointer)||[];
    list.push(flag);
    flaggedByPointer.set(pointer,list);
  }
  const assessments=rows.map((row,index)=>{
    const pointer=row.rigidPointer;
    const elements=Array.isArray(row.linkedElements)?row.linkedElements:[];
    const plan=plans[index]||{};
    const context=plan.sourceContext;
    const auditFlags=flaggedByPointer.get(pointer)||[];
    const sourceUnresolved=Boolean(context) &&
      (context.status!=='VERIFIED'||!context.mapping||context.conflicts?.length>0);
    const unreferenced=elements.length===0;
    const shared=elements.length>1;
    const nonpositive=!positive(row.weight);
    const shorts=elements.filter(el=>positive(el.lengthMm) && Number(el.lengthMm)<=limit);
    const reasons=[];
    if(auditFlags.length)reasons.push(...unique(auditFlags.map(f=>'SOURCE AUDIT: '+f.code)));
    if(nonpositive)reasons.push('Missing/nonpositive exported RIGID weight');
    if(shared)reasons.push('RIGID pointer shared by '+elements.length+' final ELEMENTS');
    if(unreferenced)reasons.push('RIGID pointer has no final ELEMENTS owner');
    if(sourceUnresolved)reasons.push('Source component ownership or metadata unresolved'+
      (context.reason?' — '+context.reason:''));
    if(shorts.length)reasons.push('Short final CII span '+shorts.map(el=>
      '#'+el.index+' '+Number(el.lengthMm).toFixed(3)+' mm').join(', ')+
      ' — review source physical component length separately');
    const issueCodes=unique([
      ...auditFlags.map(f=>f.code),
      ...(nonpositive?['NONPOSITIVE_WEIGHT']:[]),
      ...(shared?['SHARED_POINTER']:[]),
      ...(unreferenced?['UNREFERENCED_POINTER']:[]),
      ...(sourceUnresolved?['SOURCE_UNRESOLVED']:[]),
      ...(shorts.length?['SHORT_SPAN_REVIEW']:[]),
    ]);
    return {
      pointer,
      repairNeeded:issueCodes.length>0,
      auditFlagged:auditFlags.length>0,
      shortSpan:shorts.length>0,
      sourceUnresolved,
      nonpositive,
      shared,
      unreferenced,
      issueCodes,
      reasons,
      affectedElements:elements.map(el=>({
        element:el.index,fromNode:el.fromNode,toNode:el.toNode,
        routeLengthMm:el.lengthMm,
      })),
      auditFlags:auditFlags.map(f=>({
        element:f.element,code:f.code,from:f.from,to:f.to,
        lengthMm:f.lengthMm,physicalComponentRef:f.physicalComponentRef||null,
        weightN:f.weightN,
      })),
      // User-entered mass is needed for unresolved cases. The review can
      // *suggest* references but must never silently transfer catalog mass.
      automaticMassApproval:false,
      recommendedAction:auditFlags.length
        ?'Independent component mass verification and explicit RIGID pointer correction'
        :shorts.length?'Inspect short route, physical owner and exported weight'
          :reasons.length?'Review physical mass evidence':'No mass correction indicated',
    };
  });
  return {
    rows:assessments,
    summary:{
      total:rows.length,
      repairNeeded:assessments.filter(x=>x.repairNeeded).length,
      auditFlagged:assessments.filter(x=>x.auditFlagged).length,
      shortSpan:assessments.filter(x=>x.shortSpan).length,
      nonpositive:assessments.filter(x=>x.nonpositive).length,
      sourceUnresolved:assessments.filter(x=>x.sourceUnresolved).length,
      auditEvidence:actualAudit?'SOURCE_AUDIT_HOLD':'NOT_AVAILABLE',
    },
  };
}
