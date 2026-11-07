import { createUnknownComponentLengthWeightSuggester } from '../empirical-weight/unknown-component-length-suggestion.js';

// Sidecar evidence only. No candidate promotion or persisted Weight overrides.
const unknownSuggesterCache = new WeakMap();
function attachUnknownComponentSuggestion(issue, config) {
  if (!issue || issue.mapped || Number(issue.weight) > 0 || Number(issue.overrideWeight) > 0) return issue;
  if (!['component-ref-endpoint-span', 'ElementLengthMm'].includes(issue.elementLengthSource)) return issue;
  // Imported master unit conversion may be heuristic/mixed. Do not infer
  // physical master reference lengths until their unit authority is known.
  if (config?.weight?.convertSmallLengthsInToMm === true) {
    return { ...issue, unknownComponentSuggestion: {
      ok:false,code:'MASTER_LENGTH_UNIT_REVIEW_REQUIRED',
      reason:'Imported master length conversion is enabled; verify reference length units before this suggestion.',
      acceptedForCii:false,engineeringMassApproved:false,
    } };
  }
  const rows = config?.weight?.masterRows;
  if (!Array.isArray(rows) || !rows.length) return issue;
  let suggester = unknownSuggesterCache.get(rows);
  if (!suggester) {
    suggester = createUnknownComponentLengthWeightSuggester({ masterRows: rows });
    unknownSuggesterCache.set(rows, suggester);
  }
  const suggestion = suggester.suggest({componentLengthMm: issue.lengthMm,
    boreMm: issue.boreMm, rating: issue.rating, componentRefNo: issue.componentRefNo});
  return { ...issue, unknownComponentSuggestion: suggestion };
}
function text(value) {
  return value === null || value === undefined ? '' : String(value);
}

function clean(value) {
  return text(value).replace(/\s+/g, ' ').trim();
}

function formatIssueValveHint(issue) {
  const existing = clean(issue?.valveHint);
  if (existing) return existing;
  const hint = issue?.nodeHint;
  if (!hint) return '';
  const code = clean(hint.code);
  const label = clean(hint.label || hint.subtype || hint.family || 'Valve');
  return code ? `${code} → ${label}` : label;
}

function ensureIssueValveHint(issue) {
  if (!issue) return issue;
  const valveHint = formatIssueValveHint(issue);
  return valveHint && issue.valveHint !== valveHint ? { ...issue, valveHint } : issue;
}

export function buildXmlCiiFlangeWeightFallback(issue, config) {
  // Compat adapter for older UI callers. Use the ONE strict physical-family
  // selector rather than regex-matching "FLANGED" (a swing check valve!).
  // This candidate is always advisory and can NEVER qualify automatic weights.
  const rows = config?.weight?.masterRows;
  if (!Array.isArray(rows) || !rows.length ||
      config?.weight?.convertSmallLengthsInToMm === true) return null;
  const proposed = createUnknownComponentLengthWeightSuggester({
    masterRows: rows
  }).suggest({
    componentLengthMm: issue?.lengthMm,boreMm:issue?.boreMm,
    rating:issue?.rating,componentRefNo:issue?.componentRefNo
  });
  if (!proposed.ok) return null;
  const ratio = proposed.lengthRatio;
  const minRatio=Number(config?.weight?.extrapolationMinRatio??0.65);
  const maxRatio=Number(config?.weight?.extrapolationMaxRatio??1.6);
  if (!Number.isFinite(minRatio)||!Number.isFinite(maxRatio)||
      minRatio<=0||maxRatio<minRatio||ratio<minRatio||ratio>maxRatio) return null;
  const mass=proposed.suggestedKg;
  const atBoundary=proposed.atFlangeToleranceBoundary === true;
  return {
    type:proposed.referenceFamily, valveType:proposed.referenceFamily,
    typeDesc:proposed.referenceFamily,
    masterWeight:proposed.referenceWeightKg,
    rowLength:proposed.referenceLengthMm,
    rowBore:proposed.boreMm,rowRating:String(proposed.rating),
    weight:mass,selectedWeight:mass,suggestedWeight:mass,
    weightMethod:atBoundary?'flange-master-at-6mm-tolerance'
      :'unknown-reference-length-proportional',
    atFlangeToleranceBoundary:atBoundary,
    referenceFamily:proposed.referenceFamily,
    referenceEvidence:proposed.reference,
    massAuthority:'ESTIMATE_ONLY_NOT_APPROVED_COMPONENT_MASS',
    engineeringMassApproved:false,acceptedForCii:false,
    weightWarning:atBoundary
      ? 'Weldneck Flange original exact master weight at +6mm tolerance. No scaling.'
      : 'Advisory length-scaled '+proposed.referenceFamily+' reference, not source mass authority.',
    inferredWeight:true,fallbackSuggestion:true,
    flangeWeightFallback:proposed.selector==='FLANGE_REFERENCE',
    preferred:false,zeroFallback:false,
    ratingExact:true,ratingScore:1,boreDelta:0,
    lengthDelta:Math.abs(proposed.componentLengthMm-proposed.referenceLengthMm),
    lengthQualified:false,score:0.45,
    semanticSource:'',semanticReason:'Unknown physical-component reference estimate',
    candidateClass:{family:proposed.selector==='FLANGE_REFERENCE'?'FLANGE':'VALVE',
      subtype:proposed.selector==='FLANGE_REFERENCE'?'FLANGE':'BALL'},
  };
}
export function applyXmlCiiFlangeWeightFallbackToIssue(issue, config) {
  if (!issue) return issue;
  const withHint=attachUnknownComponentSuggestion(ensureIssueValveHint(issue),config);
  if (issue.mapped || Number(issue.weight)>0 || Number(issue.overrideWeight)>0)
    return withHint;
  // Ranking is never authoritative for an unknown component and must not
  // preserve an already-preferred but length-scaled/wrong-family candidate.
  // A route/forward-derived CII span is NOT a physical component span.
  const trustedSpan=['component-ref-endpoint-span','ElementLengthMm']
    .includes(withHint.elementLengthSource);
  const result = trustedSpan &&
    withHint.unknownComponentSuggestion?.ok===true
      ? buildXmlCiiFlangeWeightFallback(withHint,config) : null;
  const candidates=result?[result]:[];
  return {
    ...withHint, candidates,
    ranking:{...(withHint.ranking||{}),best:result,candidates},
    // No legacy auto-apply authority is attached to a low-trust suggestion.
    flangeWeightFallback:false,
    massSuggestionOnly:true,
    massSuggestionHold:!result,
  };
}

export function applyXmlCiiFlangeWeightFallbackToIssues(issues, config) {
  return Array.isArray(issues)
    ? issues.map((issue) => applyXmlCiiFlangeWeightFallbackToIssue(issue, config))
    : [];
}
