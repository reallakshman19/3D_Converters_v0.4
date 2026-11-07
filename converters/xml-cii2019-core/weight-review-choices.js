// Shared, display-only choices for Weight Match and consolidated rigid review.
// A catalog row never becomes an approved physical-component mass through UI
// preloading, candidate ranking, or a percentage/length-match score.
import { isApprovedPhysicalMassCandidate } from './physical-mass-approval.js';
import { classifySourceWeightFamily,isWeightMasterPhysicalFamilyMatch } from './weight-valve-hints.js';

const name = value => String(value ?? '').trim();
const positive = value => {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Show old-style alternative master lengths without weakening the exact
 * physical-family + bore + class matching gate. These are labelled COMPARISON
 * ONLY, never added to ranked candidates, and NEVER used for bulk prefill.
 */
export function comparisonWeightMasterReferences(issue={}, config={}, limit=6) {
  const rows=Array.isArray(config?.weight?.masterRows)?config.weight.masterRows:[];
  const source=classifySourceWeightFamily(issue);
  if(issue.sourceBoreHold || !['VALVE','FLANGE','BLIND'].includes(source.family))return [];
  const bore=Number(issue.boreMm);
  const rating=name(issue.rating).replace(/#/g,'');
  const componentLength=Number(issue.lengthMm);
  if(!(bore>0)||!rating)return [];
  const matches=[],seen=new Set();
  for(const raw of rows){
    if(!isWeightMasterPhysicalFamilyMatch(raw,source))continue;
    const refBore=Number(raw.DN??raw.bore??raw.Bore);
    const refRating=name(raw.Rating??raw.rating).replace(/#/g,'');
    const refLength=Number(raw.length??raw.Length??raw['RF-F/F']);
    const refWeight=positive(raw['RF/RTJ KG']??raw.weight??raw.Weight);
    if(!Number.isFinite(refBore)||!Number.isFinite(refLength)||refLength<=0||
       !refRating||refWeight===null)continue;
    const exactBore=Math.abs(bore-refBore)<.5, exactRating=rating===refRating;
    if(exactBore && exactRating)continue; // normal ranked candidate is authority
    const adjacentBore=exactRating && Math.abs(bore-refBore)<=Math.max(bore*.6,30);
    const differentClassSameBore=exactBore && !exactRating;
    if(!adjacentBore && !differentClassSameBore)continue;
    const refType=name(raw.TypeDesc??raw.typeDesc??raw.valveType??raw['Valve Type']);
    const key=[refBore,refRating,refLength,refWeight,refType].join('|');
    if(seen.has(key))continue;seen.add(key);
    matches.push({
      selectedWeight:refWeight,
      typeDesc:refType,
      rowLength:refLength,
      lengthDelta:Number.isFinite(componentLength)?Math.abs(componentLength-refLength):null,
      referenceOnly:true,
      rowBore:refBore,rowRating:refRating,
      sourceBore:bore,sourceRating:rating,
      rejectedReason:'COMPARISON ONLY: reference DN '+refBore+
        ', Class '+refRating+' vs source DN '+bore+', Class '+rating+
        '. Requires independent engineering review; not a qualified match.',
      comparisonPriority:differentClassSameBore?0:1,
      boreDelta:Math.abs(bore-refBore),
    });
  }
  matches.sort((a,b)=>a.comparisonPriority-b.comparisonPriority||
    a.boreDelta-b.boreDelta||
    Number(a.lengthDelta??Infinity)-Number(b.lengthDelta??Infinity)||
    a.rowBore-b.rowBore);
  return matches.slice(0,limit);
}

export function availableWeightReviewChoices(issue = {}) {
  if (issue?.sourceBoreHold) return [];
  const choices = [], seen = new Set();
  const add = (candidate, rejected = false) => {
    const weight = positive(candidate?.selectedWeight ?? candidate?.suggestedWeight ?? candidate?.weight);
    if (weight === null || candidate?.zeroFallback) return;
    const family = name(candidate?.referenceFamily || candidate?.typeDesc ||
      candidate?.valveType || candidate?.type || 'Master reference');
    const length = Number(candidate?.rowLength);
    const delta = Number(candidate?.lengthDelta);
    const key = [weight, family.toUpperCase(), Number.isFinite(length) ? length : '', rejected].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    choices.push({
      weight, family,
      referenceLengthMm: Number.isFinite(length) && length > 0 ? length : null,
      lengthDeltaMm: Number.isFinite(delta) ? delta : null,
      rejected,
      comparison: Boolean(candidate.referenceOnly),
      referenceBoreMm: Number.isFinite(Number(candidate.rowBore))?Number(candidate.rowBore):null,
      referenceRating: name(candidate.rowRating||''),
      sourceBoreMm: Number.isFinite(Number(candidate.sourceBore))?Number(candidate.sourceBore):null,
      sourceRating: name(candidate.sourceRating||''),
      approved: !rejected && isApprovedPhysicalMassCandidate(candidate, weight),
      reason: rejected ? name(candidate?.rejectedReason || 'Outside exact length tolerance')
        : name(candidate?.weightWarning || candidate?.weightMethod || 'master candidate'),
    });
  };
  if (!issue?.massSuggestionOnly) {
    for (const candidate of issue?.candidates || []) add(candidate);
    // A mismatched reference is visible as a DIFFERENT physical-length option,
    // not as an exact approved suggestion. Explicit Reviewed action is required.
    for (const candidate of issue?.rejectedCandidates || []) add(candidate, true);
    for (const candidate of issue?.comparisonReferences || []) add(candidate, true);
  }
  const u = issue?.unknownComponentSuggestion;
  if (u?.ok && positive(u.suggestedKg) !== null) {
    const weight = positive(u.suggestedKg);
    const family = name(u.referenceFamily || 'Unknown physical length');
    const key = [weight, family.toUpperCase(), '', false].join('|');
    if (!seen.has(key)) choices.push({
      weight, family, referenceLengthMm: positive(u.referenceLengthMm),
      lengthDeltaMm: null, rejected: false, approved: false,
      reason: 'Unknown component length-rule estimate; review only',
    });
  }
  return choices;
}

export function preferredWeightReviewDraft(issue) {
  const choices = availableWeightReviewChoices(issue);
  // Rejected length matches can be inspected and selected explicitly, but must
  // NEVER be prepopulated as though they passed the physical-length gate.
  return choices.find(choice => !choice.rejected) || null;
}

export function weightReviewChoiceLabel(choice) {
  const length = choice.referenceLengthMm === null ? '' : ' · master L=' + choice.referenceLengthMm + 'mm';
  const delta = choice.lengthDeltaMm === null ? '' : ' · Δ' + choice.lengthDeltaMm + 'mm';
  const scope=choice.comparison
    ? ' · REF DN'+choice.referenceBoreMm+'/Class'+choice.referenceRating+
      ' vs SOURCE DN'+choice.sourceBoreMm+'/Class'+choice.sourceRating
    : '';
  return choice.weight + ' kg · ' + choice.family + length + delta + scope +
    (choice.comparison ? ' · COMPARISON ONLY / NOT A MATCH' :
     choice.rejected ? ' · LENGTH MISMATCH / REVIEW' :
     choice.approved ? ' · approved source' : ' · estimate');
}
