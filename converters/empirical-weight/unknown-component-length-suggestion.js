/**
 * Read-only, low-authority suggestion for UNKNOWN components. Never apply to
 * a physical source mass, XML Weight node, CII RIGID, or parity gate.
 *
 * Frozen user rule: L < (weldneck flange length + 6 mm) selects weldneck
 * flange; L > threshold selects Flanged Ball Valve-Reduced Bore.
 * Exact equality is intentionally unresolved. Component length is its
 * physical component span, NOT an incoming CII element/gap length.
 *
 * At the chosen family/bore/rating, interpolate reference length and mass
 * across nearest TWO DN anchors if the requested bore has no exact master
 * row. The last step is a proportional length-scale heuristic from the
 * selected reference (0 kg at 0 mm, master kg at master length). This is
 * NOT measured weight or an engineering-authorized mass.
 */
import { DEFAULT_WEIGHT_MASTER_ROWS } from '../xml-cii2019-core/default-weight-master-rows.js';

export const UNKNOWN_COMPONENT_LENGTH_TOLERANCE_MM = 6;
export const UNKNOWN_COMPONENT_REFERENCE_FLANGE = 'Weldneck Flange';
export const UNKNOWN_COMPONENT_REFERENCE_VALVE = 'Flanged Ball Valve-Reduced Bore';

const number = value => {
  if(value===null || value===undefined || typeof value==='string' && !value.trim())return null;
  const n=Number(String(value).replace(/,/g,'').replace(/#$/,'').trim());
  return Number.isFinite(n)&&n>0?n:null;
};
const canonical = x => String(x??'').trim().replace(/\s+/g,' ').toUpperCase();
const median = xs => {
  const s=[...xs].sort((a,b)=>a-b);
  return s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2;
};
function normalizedTarget(target){
  const t=canonical(target||'RF/RTJ KG');
  if(['RF','RTJ','RF/RTJ','RF/RTJ KG'].includes(t))return 'RF/RTJ KG';
  if(['BW','BW KG'].includes(t))return 'BW KG';
  return null;
}
function massFromRow(row,target){
  return number(target==='BW KG'
    ? row['BW KG']??row.bwKg
    : row['RF/RTJ KG']??row.rfRtjKg??row.weight);
}
function lengthFromRow(row,target){
  // wtValveweights source length and RF-F/F are in millimetres.
  return number(row.lengthMm??row.length??
    (target==='BW KG'?row['BW-F/F']:row['RF-F/F'])??
    row['Length (RF-F/F)']);
}
function ratingOf(row){return number(row.Rating??row.rating);}
function boreOf(row){return number(row.DN??row.boreMm??row.bore);}
function familyOf(row){return canonical(row.TypeDesc??row.typeDesc??row.valveType);}
const validFamily=(type,expected)=>canonical(type)===canonical(expected);

function groupedReferenceRows(masterRows,family,rating,target){
  const groups=new Map();
  for(const row of Array.isArray(masterRows)?masterRows:[]){
    if(!validFamily(familyOf(row),family)||ratingOf(row)!==rating)continue;
    const boreMm=boreOf(row);
    const weightKg=massFromRow(row,target);
    const lengthMm=lengthFromRow(row,target);
    if(!boreMm||!weightKg||!lengthMm)continue;
    if(!groups.has(boreMm))groups.set(boreMm,[]);
    groups.get(boreMm).push({weightKg,lengthMm});
  }
  return [...groups].map(([boreMm,rows])=>({
    boreMm,
    weightKg:median(rows.map(r=>r.weightKg)),
    lengthMm:median(rows.map(r=>r.lengthMm)),
    duplicateRows:rows.length,
  })).sort((a,b)=>a.boreMm-b.boreMm);
}
function referenceAtBore(points,boreMm,family,rating,target){
  const exact=points.find(p=>Math.abs(p.boreMm-boreMm)<1e-8);
  if(exact)return{
    status:'EXACT_MASTER',
    family,rating,target,boreMm,weightKg:exact.weightKg,lengthMm:exact.lengthMm,
    anchors:[exact],fraction:0,method:'EXACT_BORE_MASTER',
  };
  const lower=points.filter(p=>p.boreMm<boreMm).at(-1);
  const upper=points.find(p=>p.boreMm>boreMm);
  if(!lower||!upper)return null;
  const fraction=(boreMm-lower.boreMm)/(upper.boreMm-lower.boreMm);
  const weightKg=lower.weightKg+fraction*(upper.weightKg-lower.weightKg);
  const lengthMm=lower.lengthMm+fraction*(upper.lengthMm-lower.lengthMm);
  if(!(weightKg>0&&lengthMm>0))return null;
  return {
    status:'DN_INTERPOLATED',
    family,rating,target,boreMm,weightKg,lengthMm,
    anchors:[lower,upper],fraction,method:'LINEAR_DN_BRACKET',
  };
}
function refusal(code,reason,data={}){
  return {ok:false,code,reason,kind:'UNKNOWN_COMPONENT_MASS_SUGGESTION',
    acceptedForCii:false,engineeringMassApproved:false,...data};
}

export function createUnknownComponentLengthWeightSuggester({
  masterRows=DEFAULT_WEIGHT_MASTER_ROWS,
  toleranceMm=UNKNOWN_COMPONENT_LENGTH_TOLERANCE_MM,
}={}){
  if(toleranceMm!==6)throw new Error('UNKNOWN_COMPONENT_TOLERANCE_FROZEN_6MM');
  const rows=Array.isArray(masterRows)?masterRows:[];
  const cache=new Map();
  function lookup(family,rating,target,boreMm){
    const key=family+'|'+rating+'|'+target;
    if(!cache.has(key))cache.set(key,groupedReferenceRows(rows,family,rating,target));
    return referenceAtBore(cache.get(key),boreMm,family,rating,target);
  }
  function suggest({componentLengthMm,boreMm,rating,target='RF/RTJ KG',componentRefNo=null}={}){
    const length=number(componentLengthMm),bore=number(boreMm),pressure=number(rating);
    const resolvedTarget=normalizedTarget(target);
    if(!length||!bore||!pressure||!resolvedTarget)
      return refusal('UNKNOWN_COMPONENT_INPUT_INCOMPLETE',
        'Positive physical component length (mm), bore DN (mm), rating and supported weight target are required.');
    const flange=lookup(UNKNOWN_COMPONENT_REFERENCE_FLANGE,pressure,resolvedTarget,bore);
    if(!flange)return refusal('FLANGE_REFERENCE_NOT_QUALIFIED',
      'No exact or two-sided interpolated Weldneck Flange length/weight reference for this bore, class and target.',
      {boreMm:bore,rating:pressure,target:resolvedTarget});
    const thresholdMm=flange.lengthMm+toleranceMm;
    if(Math.abs(length-thresholdMm)<=1e-7)
      return refusal('LENGTH_AT_DECISION_BOUNDARY',
        'Length exactly equals flange reference length + 6 mm; neither strict user rule applies.',
        {componentLengthMm:length,boreMm:bore,rating:pressure,flange,thresholdMm,toleranceMm});
    const selector=length<thresholdMm?'FLANGE_REFERENCE':'REDUCED_BORE_BALL_VALVE_REFERENCE';
    const reference=selector==='FLANGE_REFERENCE'?flange:
      lookup(UNKNOWN_COMPONENT_REFERENCE_VALVE,pressure,resolvedTarget,bore);
    if(!reference)return refusal('SELECTED_REFERENCE_NOT_QUALIFIED',
      'Selected component family has no same-rating/target exact or two-sided DN-interpolated reference.',
      {componentLengthMm:length,boreMm:bore,rating:pressure,target:resolvedTarget,
        selector,flange,thresholdMm});
    const lengthRatio=length/reference.lengthMm;
    const suggestedKg=reference.weightKg*lengthRatio;
    if(!Number.isFinite(suggestedKg)||suggestedKg<=0)
      return refusal('UNKNOWN_COMPONENT_SUGGESTION_INVALID','Invalid positive suggested weight.');
    return {
      ok:true,kind:'UNKNOWN_COMPONENT_MASS_SUGGESTION',
      status:'ADVISORY_NOT_APPLIED',method:'REFERENCE_LENGTH_PROPORTIONAL_HEURISTIC',
      selector,referenceFamily:reference.family,
      componentRefNo,componentLengthMm:length,boreMm:bore,rating:pressure,
      target:resolvedTarget,toleranceMm,thresholdMm,flange,
      reference,referenceLengthMm:reference.lengthMm,
      referenceWeightKg:reference.weightKg,lengthRatio,
      suggestedKg:Math.round(suggestedKg*1000)/1000,
      suggestedKgUnrounded:suggestedKg,
      isExtrapolatedBeyondReferenceLength:length>reference.lengthMm,
      confidence:'LOW_HEURISTIC',engineeringMassApproved:false,acceptedForCii:false,
      massAuthority:'ESTIMATE_ONLY_NOT_APPROVED_COMPONENT_MASS',
      reason:selector==='FLANGE_REFERENCE'
        ? 'Physical length is shorter than flange master length + 6 mm.'
        : 'Physical length is longer than flange master length + 6 mm.',
    };
  }
  return Object.freeze({suggest});
}
export const suggestUnknownComponentLengthWeight=(input,options)=>
  createUnknownComponentLengthWeightSuggester(options).suggest(input);
