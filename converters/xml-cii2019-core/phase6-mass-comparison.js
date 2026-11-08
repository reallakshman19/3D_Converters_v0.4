// Read-only reference comparison for Phase 6. Catalog matching is NOT a
// source of engineering physical-mass approval. Never use these results to
// persist an override without the normal independent review gate.
import {
  classifySourceWeightFamily, isWeightMasterPhysicalFamilyMatch,
} from './weight-valve-hints.js';
import {isApprovedPhysicalMassCandidate} from './physical-mass-approval.js';

const positive = value => {
  if(value===null||value===undefined||value==='')return null;
  const number=Number(value);
  return Number.isFinite(number)&&number>0?number:null;
};
const rating = value => String(value??'').replace(/#/g,'').replace(/\s+/g,'').toUpperCase();
const EPS=1e-6;
export const PHASE6_DEVIATION_LIMIT_PCT=40;

/**
 * Comparison reference: same verified source DN, Rating, physical family and
 * catalog length within ±6 mm. A rejected, heuristic or extrapolated candidate
 * cannot silently supply a reference. A reference is evidence, not approval.
 */
export function phase6ComparableReference(issue={}) {
  if(issue.sourceBoreHold)return null;
  const family=classifySourceWeightFamily(issue);
  const explicitType=String(issue.componentType??'').trim().toUpperCase();
  // A conflicting XML component type and DTXR description is not a verified
  // physical-family match, even if the description happens to match a catalog.
  if((explicitType.startsWith('VALV')||explicitType==='VLV') &&
      family.family!=='VALVE')return null;
  if(explicitType.startsWith('FLAN') &&
      !['FLANGE','BLIND'].includes(family.family))return null;
  const bore=positive(issue.boreMm), length=positive(issue.lengthMm);
  const sourceRating=rating(issue.rating);
  const tolerance=Math.min(6,Math.max(0,Number(issue.reviewLengthToleranceMm??6)));
  if(!family||bore===null||length===null||!sourceRating||
     !Number.isFinite(tolerance))return null;
  for(const candidate of issue.candidates||[]){
    // The comparison denominator is the original master weight in kg,
    // never an interpolated or scaled suggested kg. At ±6 mm an extrapolated
    // candidate may still carry a valid *unscaled* reference master row.
    const method=String(candidate?.weightMethod??candidate?.method??'');
    const derived=/interpolat|extrapolat|factor|fallback|infer|heuristic/i.test(method);
    // Some source-approved/manual same-length candidates carry selectedWeight
    // but no raw 'weight' field; only use this fallback for non-derived values.
    const masterKg=positive(candidate?.masterWeight??candidate?.weight??
      (!derived?(candidate?.selectedWeight??candidate?.suggestedWeight):null));
    if(derived && (/interpolat|factor|fallback|infer|heuristic/i.test(method) ||
       positive(candidate?.masterWeight)===null))continue;
    const kg=masterKg;
    const refL=positive(candidate?.rowLength),refDN=positive(candidate?.rowBore);
    if(kg===null||refL===null||refDN===null||
      Math.abs(refL-length)>tolerance+EPS || Math.abs(refDN-bore)>=1 ||
      rating(candidate?.rowRating)!==sourceRating ||
      candidate?.lengthQualified===false || candidate?.rejectedReason ||
      candidate?.comparison===true || candidate?.referenceOnly===true ||
      candidate?.inferredWeight===true || candidate?.fallbackSuggestion===true ||
      candidate?.flangeWeightFallback===true || candidate?.zeroFallback===true ||
      candidate?.specialFactorRule===true ||
      !isWeightMasterPhysicalFamilyMatch(candidate,family))continue;
    const approved=isApprovedPhysicalMassCandidate(candidate,kg);
    return {
      kg,source:String(candidate?.typeDesc||candidate?.referenceFamily||'Matching master'),
      lengthMm:refL,boreMm:refDN,rating:sourceRating,
      authority:approved?'APPROVED_SOURCE_MASS':'CATALOG_COMPARISON_ONLY',
      approved,
    };
  }
  return null;
}

export function phase6ReferenceErrorPercent(actualKg,referenceKg){
  const actual=positive(actualKg),reference=positive(referenceKg);
  if(actual===null||reference===null)return null;
  const percent=100*(actual-reference)/reference;
  return Number.isFinite(percent)?percent:null;
}

export function phase6DeviationForRow(issue={},actualKg){
  const reference=phase6ComparableReference(issue);
  const errorPct=reference?phase6ReferenceErrorPercent(actualKg,reference.kg):null;
  return {
    reference,errorPct,
    exceedsLimit:errorPct!==null &&
      Math.abs(errorPct)>PHASE6_DEVIATION_LIMIT_PCT+EPS,
  };
}

/** Stage-only bulk selection. Existing mapped mass and exact source match are
 * required, but comparison evidence is never itself engineering approval.
 * The UI must call stageRigidReviewProposal(...,{approved:false}) and require
 * the normal review attestation before Save.
 */
export function phase6BatchDeviationDraft(issue={},savedKg){
  if(!issue.mapped)return null;
  const result=phase6DeviationForRow(issue,savedKg);
  if(!result.exceedsLimit||!result.reference)return null;
  return {
    weight:result.reference.kg,approved:false,
    reference:result.reference.source+
      ' · DN '+result.reference.boreMm+
      ' / Class '+result.reference.rating+
      ' · reference '+result.reference.lengthMm+' mm'+
      ' · deviation '+result.errorPct.toFixed(1)+'% (comparison only)',
    method:'PHASE6_DEVIATION_GT_40_REVIEW_DRAFT',
    errorPct:result.errorPct,
  };
}
