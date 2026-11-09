import { isApprovedPhysicalMassCandidate } from '../../../converters/xml-cii2019-core/physical-mass-approval.js';
import { valveHintLengthToleranceMm, classifySourceWeightFamily, isWeightMasterPhysicalFamilyMatch } from '../../../converters/xml-cii2019-core/weight-valve-hints.js?v=20261107-glrd-bore-family-r2';
import { proposedRigidReviewWeight, stageRigidReviewProposal, clearRigidReviewProposal, rigidReviewProposalNeedsVerification, isRigidWeightReviewEligibleIssue } from './xml-cii-adapted-rigid-review-prefill.js?v=20261108-rigid-choice-buttons-1';
import { resolveStandaloneWeightReviewRating, standaloneWeightReviewRatingInfo } from './xml-cii-adapted-weight-rating-authority.js';
import { collectXmlCiiWeightMatchRows, collectXmlCiiZeroRigidWeightIssues, reconcileXmlCiiWeightMatchSourceBores } from '../../../converters/xml-cii2019-core/weight-match-model.js?v=20261107-glrd-bore-family-r2';
import { applyXmlCiiFlangeWeightFallbackToIssue } from '../../../converters/xml-cii2019-core/flange-weight-fallback.js';
import { rankXmlCiiWeightCandidates } from '../../../converters/xml-cii2019-core/weight-valve-hints.js?v=20261107-glrd-bore-family-r2';
import { flattenModeARigidReviewEntries } from './xml-cii-adapted-rigid-review-mode-a-state.js';
import { comparisonWeightMasterReferences } from '../../../converters/xml-cii2019-core/weight-review-choices.js';
import { formatValveHint } from '../../../converters/xml-cii2019-core/weight-valve-hints.js';
import { extractXmlCiiRatingFromDtxr } from '../../../converters/xml-cii2019-core/dtxr-rating-resolver.js';
import {
  phase6ComparableReference,phase6ReferenceErrorPercent,
  phase6BatchDeviationDraft,PHASE6_DEVIATION_LIMIT_PCT,
} from '../../../converters/xml-cii2019-core/phase6-mass-comparison.js';

const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attr = (value) => esc(value).replace(/'/g, '&#39;');
const text = (value) => value === undefined || value === null ? '' : String(value).trim();

/**
 * DTXR is a staged physical-component description, not an approved mass or
 * a Rating override. A JSONPath like $[187].children[43] is provenance,
 * never the text to show as the standalone tooltip.
 */
export function formatModeARigidDtxrEvidenceTooltip(issue = {}) {
  const description=text(issue.dtxr);
  const rating=extractXmlCiiRatingFromDtxr(description);
  const path=text(issue.dtxrSourcePath);
  const match=path.match(/\$[\[{](\d+)[\]}]\.children\[(\d+)\]/);
  const where=match
    ? 'Staged JSON branch ' + (Number(match[1])+1) +
      ', component ' + (Number(match[2])+1) + ' (1-based labels)'
    : (path?'Staged JSON provenance available in row Details':
      'No staged JSON source path recorded');
  return [
    description ? 'DTXR: '+description : 'DTXR unavailable',
    rating ? 'Class '+rating+'# parsed from DTXR — comparison evidence ONLY; not saved as Rating'
      : 'DTXR contains no qualified Rating',
    where,
  ].join(' · ');
}


export async function collectModeARigidWeightReviewIssues(state = {}, config = {}, {includeSkipped = false, includeMapped = false} = {}) {
  const sourceRows=includeMapped ? collectXmlCiiWeightMatchRows : collectXmlCiiZeroRigidWeightIssues;
  return reconcileXmlCiiWeightMatchSourceBores(sourceRows(state.sourceText || '', state.stagedJsonText || '', config), state.sourceText || '').filter(isRigidWeightReviewEligibleIssue).map((issue) => {
    const authority = resolveStandaloneWeightReviewRating(issue, config);
    const rating = authority.rating;
    const ranking = rating && !issue.sourceBoreHold
      ? rankXmlCiiWeightCandidates({
          boreMm: issue.boreMm,
          rating,
          lengthMm: issue.lengthMm,
          nodeName: issue.nodeName,
          componentType: issue.componentType,
          componentRefNo: issue.componentRefNo,
          dtxr: issue.dtxr,
        }, config, { includeRejected: true })
      : { candidates: [], rejectedCandidates: [] };
    return applyXmlCiiFlangeWeightFallbackToIssue({
      ...issue,
      rating,
      dtxrRating: authority.dtxrRating,
      ratingAuthority: authority,
      ratingConflict: authority.conflict,
      branchRating: issue.rating,
      // Keep the original ranked candidates; the UI shows additional buttons
      // only for qualified master lengths (±6 mm by default).
      candidates: ranking.candidates,
      rejectedCandidates: ranking.rejectedCandidates.slice(0, 3),
      reviewLengthToleranceMm: valveHintLengthToleranceMm(config),
      comparisonReferences:comparisonWeightMasterReferences({...issue,rating},config),
      existingSkipped:config?.overrides?.rigidWeightSkipped?.[issue.key]?.skipped===true &&
        Number(config?.overrides?.rigidWeightSkipped?.[issue.key]?.weightKg)===0,
    }, config);
  }).filter((issue) => {
    if(issue.mapped)return includeMapped;
    // An explicit source-specific 0kg skip is an auditable decision for this
    // run, not a positive mass. Do not nag for it a second time in Phase 6
    // or the Run gate unless the skip record is missing/invalid.
    const record=config?.overrides?.rigidWeightSkipped?.[issue.key];
    return includeSkipped || !(record?.skipped===true && Number(record.weightKg)===0);
  });
}

function ratingInfo(issue) {
  const info = standaloneWeightReviewRatingInfo(issue);
  const title = info.conflict
    ? `DTXR rating ${info.dtxrRating}# differs from resolved/override rating ${info.shownRating}.`
    : (info.missingWithDtxr
      ? `DTXR contains ${info.dtxrRating}#, but normal execution does not auto-populate Rating.`
      : (info.derivedRating ? `Resolved Rating: ${info.derivedRating}` : 'Rating used for weight suggestions'));
  return { ...info, title };
}


/** The old UI offered buttons for ranked candidates, not cross-DN reference
 * comparisons. Alternative buttons must pass physical family, exact DN/Class,
 * and the source length gate. The primary calculated fallback may be outside
 * ±6 mm but is clearly an estimate requiring separate acceptance.
 */
export function modeARigidSelectableSuggestions(issue = {}) {
  if(issue.sourceBoreHold)return [];
  const family=classifySourceWeightFamily(issue);
  const rated=String(issue.rating ?? '').replace(/#/g,'').trim();
  const bore=Number(issue.boreMm),length=Number(issue.lengthMm);
  const tolerance=Number.isFinite(Number(issue.reviewLengthToleranceMm))
    ? Math.min(6,Math.max(0,Number(issue.reviewLengthToleranceMm))) : 6;
  const candidates=issue.massSuggestionOnly?[]:(issue.candidates||[]);
  const seen=new Set(),results=[];
  for(let i=0;i<candidates.length;i++){
    const c=candidates[i],weight=Number(c?.suggestedWeight??c?.selectedWeight??c?.weight);
    if(!Number.isFinite(weight)||weight<=0||c?.zeroFallback)continue;
    if(i>0){
      const referenceLength=Number(c.rowLength);
      const referenceBore=Number(c.rowBore);
      const referenceRating=String(c.rowRating??'').replace(/#/g,'').trim();
      if(!Number.isFinite(length)||length<=0||
        !Number.isFinite(referenceLength)||referenceLength<=0||
        Math.abs(referenceLength-length)>tolerance+1e-6||
        c.lengthQualified===false||
        !Number.isFinite(bore)||!Number.isFinite(referenceBore)||
        Math.abs(referenceBore-bore)>=1 || !rated||rated!==referenceRating||
        !isWeightMasterPhysicalFamilyMatch(c,family))continue;
    }
    const label=String(c.referenceFamily||c.typeDesc||c.valveType||c.type||'Master reference').trim();
    const method=c.preferred?'exact-length master':String(c.weightMethod||'ranked master').trim();
    const displayMethod=/BLIND[\s-]*FLANGE/i.test(label)&&
      (c.inferredWeight||c.fallbackSuggestion)?'estimate only':method;
    const referenceLength=Number(c.rowLength);
    const key=[weight,label.toUpperCase(),Number.isFinite(referenceLength)?referenceLength:'',method].join('|');
    if(seen.has(key))continue;
    seen.add(key);
    results.push({weight,label,method,displayMethod,approved:isApprovedPhysicalMassCandidate(c,weight),
      referenceLengthMm:Number.isFinite(referenceLength)&&referenceLength>0?referenceLength:null,
      primary:i===0,source:'ranked'});
  }
  // Nearby cross-DN/Class references are visible ONLY as comparison drafts.
  // They never become ranked matches or approved physical source masses.
  const deltaLimit=Math.min(6,tolerance);
  for(const ref of issue.comparisonReferences||[]){
    const refLength=Number(ref.rowLength),refWeight=Number(
      ref.selectedWeight??ref.suggestedWeight??ref.weight);
    if(!(length>0 && refLength>0 && Math.abs(refLength-length)<=deltaLimit+1e-6) ||
       !(refWeight>0) || !isWeightMasterPhysicalFamilyMatch(ref,family))continue;
    const label=String(ref.typeDesc||ref.referenceFamily||'Master reference');
    const key=[refWeight,label.toUpperCase(),refLength,'comparison'].join('|');
    if(seen.has(key))continue;
    seen.add(key);
    results.push({weight:refWeight,label,method:'COMPARISON ONLY / NOT A MATCH',
      displayMethod:'COMPARISON ONLY / NOT A MATCH',
      approved:false,referenceLengthMm:refLength,primary:false,
      source:'comparison',comparison:true,
      masterBore:ref.rowBore,masterRating:ref.rowRating});
  }
  const unknown=issue.unknownComponentSuggestion;
  if(!results.length && unknown?.ok){
    const weight=Number(unknown.suggestedKg);
    if(Number.isFinite(weight)&&weight>0)results.push({
      weight,label:String(unknown.referenceFamily||'Unknown component'),method:'physical-length rule',
      displayMethod:'estimate only',approved:false,referenceLengthMm:null,
      primary:true,source:'unknown',
    });
  }
  return results;
}

export function modeARigidCandidateMarkup(issue,rowIndex) {
  const choices=modeARigidSelectableSuggestions(issue);
  if(!choices.length){
    const hold=issue.unknownComponentSuggestion;
    return hold&&!hold.ok
      ? `<span data-mode-a-unknown-weight-hold="true" title="${attr(hold.reason||hold.code)}"
          style="font-size:11px;color:#b7a6d7;">Unknown length-rule HOLD · ${esc(hold.code)}</span>`
      : '';
  }
  return `<div data-mode-a-rigid-suggestions style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
    ${choices.map((choice,i)=>{
      const title=[
        choice.approved?'Approved physical source mass':'Estimate only: independent batch confirmation required',
        'Method: '+choice.method,
        'Source DN '+(issue.boreMm??'?')+', Class '+(issue.rating??'?'),
        choice.referenceLengthMm===null?'':'Master length '+choice.referenceLengthMm+' mm',
        i?'Additional master within ±'+Math.min(6,Math.max(0,Number(issue.reviewLengthToleranceMm??6)))+' mm':'',
        choice.comparison?'REF DN '+choice.masterBore+'/Class '+choice.masterRating+
          ' versus source DN '+issue.boreMm+'/Class '+issue.rating+' — NOT A MATCH':'',
      ].filter(Boolean).join(' | ');
      const lengthSuffix=i&&choice.referenceLengthMm!==null
        ? ' · L='+choice.referenceLengthMm+' mm' : '';
      const label=(choice.approved?'★ ':'≈ ')+choice.weight+' kg · '+choice.label+
        ' · '+choice.displayMethod+lengthSuffix;
      return `<button type="button" class="mc-rigid-review-candidate"
        data-mode-a-rigid-candidate="${rowIndex}"
        data-mode-a-rigid-option="${i}"
        data-mode-a-rigid-weight="${attr(choice.weight)}"
        data-mode-a-rigid-approved="${choice.approved}"
        data-mode-a-rigid-reference="${attr(choice.label+' · '+choice.method)}"
        title="${attr(title)}"
        aria-pressed="false"
        style="font-size:11px;line-height:1.3;padding:5px 9px;cursor:pointer;
          border:1px solid #7c9bd2;border-radius:999px;background:#173a64;
          color:#eaf3ff;white-space:normal;text-align:left;max-width:355px;">${esc(label)}</button>`;
    }).join('')}
  </div>`;
}

/** A 100% catalog score alone is not source-mass approval. */
export function phase6QualifiedExactCandidate(row){
  const best=row.candidates?.[0];
  const weight=Number(best?.suggestedWeight??best?.selectedWeight??best?.weight);
  const length=Number(row.lengthMm),masterLength=Number(best?.rowLength);
  const score=Number(best?.totalScore??best?.score);
  const qualified=Number.isFinite(score)&&(Math.abs(score-1)<1e-6||
    Math.abs(score-100)<1e-6);
  const maxDelta=Math.min(6,Math.max(0,Number(row.reviewLengthToleranceMm??6)));
  return best?.preferred===true && qualified &&
    best.lengthQualified!==false && Number.isFinite(weight)&&weight>0 &&
    (!Number.isFinite(masterLength)||Math.abs(masterLength-length)<=maxDelta+1e-6) &&
    isApprovedPhysicalMassCandidate(best,weight) ? {weight,source:best} : null;
}

function phase6EvidenceDetails(issue) {
  const fields=[
    ['Source XML',issue.fileName||issue.alias||issue.sourceId],
    ['Branch',issue.branchName],
    ['Line Key',issue.lineKey],['Component Type',issue.componentType],
    ['Component Ref / Endpoint',(issue.componentRefNo||'')+(issue.endpoint?'_'+issue.endpoint:'')],
    ['Valve Hint',formatValveHint(issue.nodeHint)],
    ['Current Mass (kg)',issue.mapped?issue.weight:issue.existingSkipped?'0 (skip)':'unresolved'],
    ['Original XML Mass (kg)',issue.originalWeight],
    ['Weight Source',issue.weightSource],
    ['Status',issue.mapped?'MAPPED':issue.existingSkipped?'SKIPPED':'REVIEW'],
    ['Match Score',issue.candidates?.[0]?.totalScore],
    ['Reference kg',phase6ComparableReference(issue)?.kg??'None (qualified match unavailable)'],
    ['DTXR staged source path (technical)',issue.dtxrSourcePath||'Not available'],
    ['DTXR Rating status','Comparison evidence only unless explicitly applied through the DTXR Rating control'],
    ['Reference authority',phase6ComparableReference(issue)?.authority??'NO_MATCH'],
    ['Candidate Type',issue.candidates?.[0]?.typeDesc],
  ];
  return `<details data-phase6-row-details style="margin-top:4px;font-size:10px;">
    <summary style="cursor:pointer;color:#93c5fd;">Details</summary>
    <div style="min-width:260px;padding:5px;background:#14243d;border:1px solid #475569;
      border-radius:4px;line-height:1.6;white-space:normal;">
      ${fields.map(([label,value])=>`<div><strong>${esc(label)}:</strong>
        ${esc(value===null||value===undefined||value===''?'—':value)}</div>`).join('')}
    </div>
  </details>`;
}

function rowMarkup(issue, rowIndex) {
  const best = issue.candidates?.[0] || null;
  const reference = issue.phase6?phase6ComparableReference(issue):null;
  const referenceError=reference && issue.mapped
    ?phase6ReferenceErrorPercent(issue.weight,reference.kg):null;
  const info = ratingInfo(issue);
  const badge = info.conflict
    ? '<span title="Rating conflict with DTXR" style="color:#fca5a5;font-weight:700;"> !</span>'
    : (info.missingWithDtxr ? '<span title="DTXR Rating available as evidence" style="color:#fbbf24;font-weight:700;"> DTXR</span>' : '');
  const search = [issue.fileName, issue.alias, issue.branchName, issue.nodeNumberDisplay, issue.nodeNumber, issue.componentRefNo, issue.endpoint, issue.key, issue.dtxr].map((value) => text(value).toLowerCase()).join(' ');
  return `<tr data-mode-a-rigid-review-row data-source-id="${attr(issue.sourceId)}" data-review-id="${attr(issue.reviewId)}" data-issue-key="${attr(issue.key)}" data-search="${attr(search)}">
    <td style="padding:7px;border-bottom:1px solid rgba(148,163,184,.1);white-space:nowrap;">${esc(issue.fileName || issue.alias || issue.sourceId)}</td>
    <td title="${attr(issue.branchName)}" style="padding:7px;border-bottom:1px solid rgba(148,163,184,.1);min-width:260px;">${esc(issue.branchName)}</td>
    <td title="${attr([issue.sourceBoreAuthority || 'original XML', issue.sourceOutsideDiameterMm ? `Source OD ${issue.sourceOutsideDiameterMm} mm` : '', issue.boreAuthorityMismatch ? `Corrected projected DN ${issue.projectedBoreMm}` : ''].filter(Boolean).join(' | '))}" style="padding:7px;border-bottom:1px solid rgba(148,163,184,.1);">${esc(issue.boreMm == null ? '' : `${Number(issue.boreMm).toFixed(0)} mm`)}</td>
    <td style="padding:7px;border-bottom:1px solid rgba(148,163,184,.1);"><input type="text" class="mc-rigid-review-rating-input" data-review-id="${attr(issue.reviewId)}" data-source-id="${attr(issue.sourceId)}" data-issue-key="${attr(issue.key)}" value="${attr(info.shownRating)}" title="${attr(info.title)}" style="width:64px;background:#101827;color:#fff;border:1px solid ${info.conflict || info.missingWithDtxr ? '#ef4444' : '#31455f'};border-radius:4px;padding:4px;font-size:11px;">${badge}</td>
    <td style="padding:7px;border-bottom:1px solid rgba(148,163,184,.1);min-width:140px;" title="Original source component: ${attr(issue.componentRefNo || 'n/a')} / endpoint ${attr(issue.endpoint || 'n/a')}">
      <strong>${esc(issue.nodeNumberDisplay || issue.nodeNumber)}</strong>
      <div data-rigid-review-source-ref style="font-size:10px;color:#9fb5d1;overflow-wrap:anywhere;">${esc(issue.componentRefNo || 'No ref')}${issue.endpoint ? '_' + esc(issue.endpoint) : ''}</div>
      ${issue.phase6?phase6EvidenceDetails(issue):''}</td>
    <td title="${attr(formatModeARigidDtxrEvidenceTooltip(issue))}" data-dtxr-source-path="${attr(issue.dtxrSourcePath||'')}" style="padding:7px;border-bottom:1px solid rgba(148,163,184,.1);min-width:180px;">${esc(issue.dtxr || 'Not found')}</td>
    <td style="padding:7px;border-bottom:1px solid rgba(148,163,184,.1);white-space:nowrap;">${esc(issue.lengthMm == null ? '' : `${Number(issue.lengthMm).toFixed(1)} mm`)}</td>
    <td style="padding:7px;border-bottom:1px solid rgba(148,163,184,.1);">
       <input type="number" min="0" step="0.001" class="mc-rigid-review-input"
         data-review-id="${attr(issue.reviewId)}" data-source-id="${attr(issue.sourceId)}"
         data-issue-key="${attr(issue.key)}"
         data-original-weight="${attr(issue.phase6 && issue.mapped?issue.weight:'')}"
         ${issue.phase6 && issue.existingSkipped?'data-rigid-skipped-zero="true"':''}
         value="${attr(issue.phase6?(issue.mapped?issue.weight:(issue.existingSkipped?'0':'')):'')}"
         placeholder="kg" style="width:92px;background:#101827;color:#fff;border:1px solid #31455f;border-radius:4px;padding:4px;">
    </td>
    <td style="padding:7px;border-bottom:1px solid rgba(148,163,184,.1);min-width:300px;">${modeARigidCandidateMarkup(issue, rowIndex) || '<span style="color:#64748b;">No suggestion</span>'}</td>
    <td>${esc(issue.lineKey||'—')}</td>
    <td>${esc(issue.componentType||'—')}</td>
    <td>${esc((issue.componentRefNo||'—')+(issue.endpoint?'_'+issue.endpoint:''))}</td>
    <td>${esc(formatValveHint(issue.nodeHint)||'—')}</td>
    <td>${esc(issue.mapped?issue.weight+' kg':(issue.existingSkipped?'0 kg skip':'—'))}</td>
    ${issue.phase6?`<td data-phase6-reference-kg="${attr(reference?.kg??'')}"
      title="${attr(reference?(reference.source+' · '+reference.lengthMm+'mm · '+
      (reference.approved?'approved source mass':'master comparison only; NOT independently approved')):
      'No verified same-family DN/Class reference within ±6mm')}">
      ${reference?esc(reference.kg.toFixed(3)+' kg'):'—'}
      ${reference && !reference.approved?'<small style="color:#fbbf24;"> · comparison</small>':''}
    </td><td data-phase6-error-pct
      title="Signed (selected kg − reference kg) / reference kg × 100; not an approval decision">
      ${referenceError===null?'—':esc((referenceError>=0?'+':'')+referenceError.toFixed(1)+'%')}
    </td>`:''}
    <td>${esc(issue.originalWeight!=null?issue.originalWeight+' kg':'—')}</td>
    <td>${esc(issue.weightSource||'unresolved')}</td>
    <td>${esc(issue.mapped?'MAPPED':(issue.existingSkipped?'SKIPPED':'REVIEW'))}</td>
    <td>${esc(issue.candidates?.[0]?.totalScore==null?'—':
      (Number(issue.candidates[0].totalScore)<=1?
        Math.round(Number(issue.candidates[0].totalScore)*100):Math.round(Number(issue.candidates[0].totalScore)))+'%')}</td>
    <td>${esc(issue.candidates?.[0]?.typeDesc||'—')}</td>
    <td>${issue.phase6?'<button type="button" data-phase6-row-edit title="Edit saved or missing source mass; save with the same review authority">Edit</button>':''}</td>
  </tr>`;
}


/** Present every pending source mass in an inspectable, scrollable review table.
 * Escaping is required: source XML names and DTXR are untrusted strings.
 */
export function modeABulkReviewTableMarkup(drafts = []) {
  const header = ['#','Source XML','Branch','Node','Component reference / endpoint','Draft mass (kg)','DTXR description'];
  const th = value => `<th scope="col" style="position:sticky;top:0;z-index:1;padding:7px 9px;
    text-align:left;background:#1e3654;color:#e9f4ff;border-bottom:1px solid #6e91bd;white-space:nowrap;">${value}</th>`;
  const td = (value, numeric = false) => `<td style="padding:7px 9px;
    border-bottom:1px solid rgba(148,163,184,.22);overflow-wrap:anywhere;
    ${numeric?'white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums;':''}">${esc(value)}</td>`;
  return `<table data-mode-a-rigid-bulk-review-table style="width:100%;min-width:880px;
    border-collapse:collapse;table-layout:auto;font-size:12px;color:#dceaff;">
    <thead><tr>${header.map(th).join('')}</tr></thead>
    <tbody>${drafts.map((draft,i)=>`<tr data-mode-a-rigid-bulk-review-row
      style="background:${i%2?'#162d48':'#11243c'};">
      ${td(i+1)}${td(draft.fileName)}${td(draft.branchName)}
      ${td(draft.nodeNumber)}${td(draft.componentRef)}
      ${td(draft.weightKg,true)}${td(draft.dtxr)}
    </tr>`).join('')}</tbody>
  </table>`;
}

function popupMarkup(rows, entries, {phase6=false}={}) {
  const sourceOptions = entries.map((entry) => `<option value="${attr(entry.sourceId)}">${esc(entry.fileName)}</option>`).join('');
  return `<div class="mc-rigid-review-dialog" role="dialog" aria-modal="true" aria-label="Consolidated rigid zero weight review" style="color:#e2e8f0;max-height:90vh;overflow:auto;background:#0f172a;border:1px solid #253a55;border-radius:8px;padding:18px;max-width:1380px;width:96%;">
    <div style="display:flex;justify-content:space-between;gap:16px;align-items:center;border-bottom:1px solid #253a55;padding-bottom:12px;margin-bottom:12px;">
      <div><div style="font-size:18px;font-weight:700;color:#9cc5ff;">Rigid Weights Need Review — Consolidated</div><div data-mode-a-rigid-summary style="font-size:12px;color:#94a3b8;margin-top:4px;">${rows.length} rigid node(s) across ${entries.length} XML file(s).</div></div>
      <button type="button" data-mode-a-rigid-cancel style="cursor:pointer;background:transparent;border:1px solid #475569;border-radius:6px;color:#94a3b8;padding:6px 12px;">${phase6?'Cancel Review':'Cancel Batch Run'}</button>
    </div>
    <div style="background:#2a210b;border:1px solid #7c5a18;color:#ffe7a3;padding:9px;border-radius:6px;font-size:12px;margin-bottom:10px;">One review gate covers all enabled XML models. Source identity is preserved; Rating and Weight changes are written only to that XML. “Use All Exact Suggestions” fills only independently approved source masses. Empirical estimates are review drafts only. Apply All Suggestions prepopulates suggested kg but does not approve or save them. To proceed, independently verify each estimated mass and use Review draft weights for an explicit bulk engineering acknowledgment. There is no per-row approval checkbox. Unreviewed values will not be written. Enter mass in kg; the optional kg→N CII export conversion applies ×10 only at output. “Skip blank” explicitly marks empty rows as 0 kg with no verified mass (logged separately; zero is not approved source mass). Use “Show missing” to see source refs and locate outstanding rows.</div>
    ${phase6?'<div data-phase6-popup-counters role="status" aria-live="polite" style="display:flex;flex-wrap:wrap;gap:12px;margin:8px 0;padding:8px 10px;border:1px solid #334155;border-radius:6px;color:#dbeafe;font-size:12px;"></div>':''}
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">
      <input type="search" data-mode-a-rigid-search placeholder="Search source / branch / node / component ref..." style="min-width:250px;padding:6px;background:#0b1220;color:#e2e8f0;border:1px solid #475569;border-radius:5px;">
      <select data-mode-a-rigid-source style="padding:6px;background:#0b1220;color:#e2e8f0;border:1px solid #475569;border-radius:5px;"><option value="">All XML files</option>${sourceOptions}</select>
      <button type="button" data-mode-a-rigid-refresh style="cursor:pointer;background:#1e293b;border:1px solid #334155;color:#cbd5e1;border-radius:6px;padding:7px 12px;">Refresh Suggestions</button>
      <button type="button" data-mode-a-rigid-show-missing title="Filter to rows requiring positive weight or explicit skip" style="cursor:pointer;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:7px 12px;">Show missing (0)</button>
       <button type="button" data-mode-a-rigid-skip-blanks title="Explicitly mark remaining blank physical components as 0 kg (skipped, no source mass assigned). Never creates an approved weight." style="cursor:pointer;background:#2b3342;color:#e2e8f0;border:1px solid #475569;border-radius:6px;padding:7px 12px;">Skip blank</button>
       <button type="button" data-mode-a-rigid-apply-suggestions style="cursor:pointer;background:#43330f;color:#ffe7a3;border:1px solid #ad8129;border-radius:6px;padding:7px 12px;">Apply All Suggestions</button>
       <button type="button" data-mode-a-rigid-show-unreviewed title="Locate source rows whose estimated masses still need approval" style="cursor:pointer;background:#1e293b;border:1px solid #475569;color:#e2e8f0;border-radius:6px;padding:7px 12px;">Show pending reviews (0)</button>
       <button type="button" data-mode-a-rigid-open-review title="Explicitly acknowledge independently verified estimated masses before final Apply" style="cursor:pointer;background:#1d3452;border:1px solid #5377ae;color:#e9f4ff;border-radius:6px;padding:7px 12px;">Review draft weights (0)</button>
      ${phase6?'<button type="button" data-phase6-approve-all title="Open the independent mass review for all pending drafts; never approves without explicit engineering attestation" style="padding:7px 12px;cursor:pointer;background:#163b43;color:#a7f3d0;border:1px solid #4db69c;border-radius:6px;">🛡 Approve all drafts (0)</button><button type="button" data-phase6-deviation40 title="Stage same-family, same DN/Class and ±6 mm references only when an EXISTING mass differs by more than 40%. This creates UNAPPROVED drafts, never saved masses." style="padding:7px 12px;cursor:pointer;background:#4a2c18;color:#fbd38d;border:1px solid #b97739;border-radius:6px;">Stage |Error| &gt;40% (0)</button><button type="button" data-phase6-dtxr style="padding:7px 12px;background:#1d3452;color:#e9f4ff;border:1px solid #5377ae;border-radius:6px;cursor:pointer;" title="Explicitly rerank suggestions by DTXR Rating; click again to restore original Preview Rating">Use Rating as per DTXR</button><button type="button" data-phase6-nearest style="padding:7px 12px;background:#43330f;color:#ffe7a3;border:1px solid #ad8129;border-radius:6px;cursor:pointer;" title="Fill blank weights only, without replacing an existing approved or manual mass">Apply nearest suggestions</button><button type="button" data-phase6-find-exact style="padding:7px 12px;background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:6px;cursor:pointer;" title="List source-approved exact candidates; catalog-perfect scores are not physical-mass approval">Find Exact Weight Matches</button><button type="button" data-phase6-fill-similar style="padding:7px 12px;background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:6px;cursor:pointer;" title="Fill grouped source-approved exact candidates only, never overwrite mapped rows">Fill Similar Exact</button>':''}
      <button type="button" data-mode-a-rigid-fill-exact style="cursor:pointer;background:#1e293b;border:1px solid #334155;color:#cbd5e1;border-radius:6px;padding:7px 12px;">Use All Exact Suggestions</button>
      <span data-mode-a-rigid-status role="status" aria-live="polite" style="font-size:12px;color:#94a3b8;flex-basis:100%;"></span>
    </div>
    <div data-mode-a-rigid-missing-list role="status" style="display:none;max-height:118px;overflow:auto;font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere;background:#281b11;border:1px solid #855328;color:#fbd38d;border-radius:6px;padding:8px;margin:0 0 8px;"></div>
    <div data-mode-a-rigid-bulk-review-panel style="display:none;background:#11223a;border:2px solid #7298ca;color:#edf6ff;border-radius:8px;padding:14px;margin:0 0 12px;">
      <div style="font-weight:700;font-size:15px;">Independent mass review required before ${phase6?'Save (No Run)':'Run'}</div>
      <div data-mode-a-rigid-bulk-review-summary style="margin:8px 0;font-size:12px;"></div>
      <div data-mode-a-rigid-bulk-review-examples style="max-height:260px;overflow:auto;font-size:12px;color:#cfdef4;margin-bottom:10px;border:1px solid #486384;border-radius:5px;" aria-label="Pending physical-component mass review table" tabindex="0"></div>
      <label style="display:flex;align-items:flex-start;gap:8px;font-size:12px;margin:8px 0;">
        <input type="checkbox" data-mode-a-rigid-bulk-attest style="margin-top:3px;">
        <span><strong>I confirm I independently verified the physical-component masses for every pending draft listed above.</strong>
        Confirming the batch is an engineering acceptance of those values for this conversion; the catalog score alone is not approval.
        All unverified/incorrect masses must be corrected or excluded before I confirm.</span>
      </label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" data-mode-a-rigid-confirm-bulk-review disabled style="padding:8px 13px;background:#2563eb;border:1px solid #60a5fa;color:white;border-radius:6px;cursor:pointer;">Confirm independently reviewed drafts</button>
        <button type="button" data-mode-a-rigid-close-bulk-review style="padding:8px 13px;background:transparent;border:1px solid #475569;color:#cbd5e1;border-radius:6px;cursor:pointer;">Return to weight table</button>
      </div>
    </div>
    ${phase6?'<div style="font-size:11px;color:#9fb5d1;margin:5px 0;">Extra engineering columns continue to the right; scroll horizontally, or expand <strong>Details</strong> under any Node to inspect full source and matching evidence.</div>':''}
    <div style="overflow:auto;max-height:55vh;border:1px solid rgba(148,163,184,.15);border-radius:6px;"><table style="border-collapse:collapse;font-size:12px;width:100%;text-align:left;"><thead><tr style="background:#1e293b;color:#fff;position:sticky;top:0;z-index:2;"><th style="padding:7px;background:#1e293b;">Source XML</th><th style="padding:7px;">Branch</th><th style="padding:7px;">Bore</th><th style="padding:7px;">Rating</th><th style="padding:7px;">Node</th><th style="padding:7px;">DTXR</th><th style="padding:7px;">Length</th><th style="padding:7px;">Manual Weight (kg)</th><th style="padding:7px;">Nearest Suggestions</th>
      <th style="padding:7px;">Line Key</th><th style="padding:7px;">Component Type</th>
      <th style="padding:7px;">Component Ref / Endpoint</th><th style="padding:7px;">Valve Hint</th>
      <th style="padding:7px;">Current Weight</th>
      ${phase6?'<th style="padding:7px;">Reference (kg)</th><th style="padding:7px;">Error %</th>':''}
      <th style="padding:7px;">Original XML Weight</th><th style="padding:7px;">Weight Source</th>
      <th style="padding:7px;">Status</th><th style="padding:7px;">Score</th>
      <th style="padding:7px;">Candidate Type</th><th style="padding:7px;">Action</th>
      </tr></thead><tbody data-mode-a-rigid-body>${rows.map(rowMarkup).join('')}</tbody></table></div>
    <div style="display:flex;justify-content:flex-end;margin-top:14px;border-top:1px solid #253a55;padding-top:14px;"><button type="button" data-mode-a-rigid-apply style="cursor:pointer;background:#1e4ed8;border:none;color:#fff;border-radius:6px;padding:9px 18px;font-weight:700;">${phase6?'Save Reviewed Weights (No Run)':'Apply Weights and Run All Models'}</button></div>
  </div>`;
}


/**
 * Phase 6 is a source-mass workbench, not a 20-column report.
 * Keep the essential engineering columns and actual editable rows above the
 * fold. Preserve every column/control in DOM; advanced tools/columns are
 * explicitly expandable and use the same existing event handlers.
 *
 * The conversion-time popup (phase6=false) deliberately retains its current
 * layout. This is presentation only: neither collector nor save policy changes.
 */
function installPhase6ReviewLayout(overlay) {
  // The standalone GLRD harness does not load the full tab stylesheet.
  // Make the popup's viewport positioning deterministic in both the app
  // and in the isolated browser verification environment.
  Object.assign(overlay.style,{
    position:'fixed',inset:'0',zIndex:'10020',
    display:'flex',alignItems:'center',justifyContent:'center',
    padding:'12px',boxSizing:'border-box',
    background:'rgba(0,0,0,.62)',
    overflow:'hidden',
  });
  const dialog=overlay.querySelector('.mc-rigid-review-dialog');
  if(!dialog)return;
  dialog.classList.add('mc-rigid-review-dialog--phase6');
  dialog.setAttribute('aria-label','Phase 6 consolidated editable physical mass review');
  Object.assign(dialog.style,{
    width:'min(1700px, calc(100vw - 28px))',
    maxWidth:'1700px',
    height:'min(860px, calc(100dvh - 28px))',
    maxHeight:'calc(100dvh - 28px)',
    boxSizing:'border-box',
    padding:'12px 14px',
    overflow:'hidden',
    display:'flex',
    flexDirection:'column',
    position:'relative',
  });

  const header=dialog.firstElementChild;
  header?.classList.add('mc-phase6-dialog-header');
  if(header)Object.assign(header.style,{
    paddingBottom:'8px',marginBottom:'6px',flex:'0 0 auto'
  });

  // The long engineering disclaimer remains fully available, but no longer
  // consumes multiple lines ahead of the editable table on every open.
  const warning=header?.nextElementSibling;
  if(warning){
    const guidance=document.createElement('details');
    guidance.className='mc-phase6-guidance';
    guidance.setAttribute('data-phase6-guidance','');
    const summary=document.createElement('summary');
    summary.textContent='Engineering rules · estimates need independent review · kg→N (×10) at export';
    summary.setAttribute('title','Expand the full source-mass approval, draft, and 0 kg skip rules');
    warning.replaceWith(guidance);
    warning.style.cssText='padding:8px 10px;color:#ffe7a3;line-height:1.35;font-size:12px;';
    guidance.append(summary,warning);
  }

  const counters=dialog.querySelector('[data-phase6-popup-counters]');
  if(counters)Object.assign(counters.style,{
    margin:'5px 0',padding:'7px 9px',flex:'0 0 auto',gap:'10px'
  });

  const search=dialog.querySelector('[data-mode-a-rigid-search]');
  const toolbar=search?.parentElement;
  if(toolbar){
    toolbar.classList.add('mc-phase6-toolbar');
    Object.assign(toolbar.style,{marginBottom:'4px',display:'block',flex:'0 0 auto'});
    const primary=document.createElement('div');
    primary.className='mc-phase6-primary-actions';
    const extra=document.createElement('div');
    extra.className='mc-phase6-extra-actions';
    const more=document.createElement('details');
    more.className='mc-phase6-more-actions';
    more.setAttribute('data-phase6-more-actions','');
    const moreSummary=document.createElement('summary');
    moreSummary.textContent='More matching and batch tools';
    moreSummary.setAttribute('title','Show DTXR, exact-match, deviation and other advanced controls');

    const primarySelectors=[
      '[data-mode-a-rigid-search]','[data-mode-a-rigid-source]',
      '[data-mode-a-rigid-show-missing]','[data-mode-a-rigid-skip-blanks]',
      '[data-mode-a-rigid-apply-suggestions]',
      '[data-mode-a-rigid-open-review]','[data-phase6-approve-all]',
    ];
    const extraSelectors=[
      '[data-mode-a-rigid-refresh]','[data-mode-a-rigid-show-unreviewed]',
      '[data-phase6-deviation40]','[data-phase6-dtxr]',
      '[data-phase6-nearest]','[data-phase6-find-exact]',
      '[data-phase6-fill-similar]','[data-mode-a-rigid-fill-exact]',
    ];
    for(const selector of primarySelectors){
      const control=toolbar.querySelector(selector);
      if(control)primary.appendChild(control);
    }
    for(const selector of extraSelectors){
      const control=toolbar.querySelector(selector);
      if(control)extra.appendChild(control);
    }
    more.append(moreSummary,extra);
    toolbar.prepend(primary);
    toolbar.append(more);
    const status=toolbar.querySelector('[data-mode-a-rigid-status]');
    if(status){
      status.classList.add('mc-phase6-action-status');
      toolbar.appendChild(status);
    }
    // Full original columns are retained, and searchable within every row's
    // Details expander even when the initial compact view is selected.
    const toggle=document.createElement('button');
    toggle.type='button';
    toggle.className='mc-phase6-columns-toggle';
    toggle.setAttribute('data-phase6-toggle-columns','');
    toggle.setAttribute('aria-pressed','false');
    toggle.textContent='All columns';
    toggle.title='Switch between readable essential columns and the full engineering table';
    toggle.addEventListener('click',()=>{
      const expanded=dialog.classList.toggle('mc-phase6-show-all');
      toggle.textContent=expanded?'Essential columns':'All columns';
      toggle.setAttribute('aria-pressed',String(expanded));
    });
    primary.appendChild(toggle);
  }

  const missing=dialog.querySelector('[data-mode-a-rigid-missing-list]');
  missing?.classList.add('mc-phase6-missing-list');
  const review=dialog.querySelector('[data-mode-a-rigid-bulk-review-panel]');
  review?.classList.add('mc-phase6-bulk-review');

  const tableBody=dialog.querySelector('[data-mode-a-rigid-body]');
  const table=tableBody?.closest('table');
  const viewport=table?.parentElement;
  if(viewport){
    viewport.classList.add('mc-phase6-table-viewport');
    viewport.style.maxHeight='none';
    viewport.style.overflow='auto';
    viewport.setAttribute('tabindex','0');
    viewport.setAttribute('aria-label','Scroll editable physical-component masses vertically; use All columns to inspect every engineering field');
    table?.classList.add('mc-phase6-weight-table');
    // The former horizontal-scroll notice was more visible than the rows.
    const notice=viewport.previousElementSibling;
    if(notice && notice.tagName==='DIV' && notice.textContent.includes('Extra engineering columns')){
      notice.classList.add('mc-phase6-columns-note');
      notice.textContent='Essential columns shown · expand Details for source evidence or choose All columns';
    }
  }
  const save=dialog.querySelector('[data-mode-a-rigid-apply]');
  save?.parentElement?.classList.add('mc-phase6-dialog-footer');

  const css=document.createElement('style');
  css.setAttribute('data-phase6-layout-styles','');
  css.textContent=[
    '.mc-rigid-review-dialog--phase6 > :not(style){flex-shrink:0;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-guidance{margin:0 0 4px;border:1px solid #705b1a;background:#2a210b;color:#ffe7a3;border-radius:6px;font-size:12px;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-guidance > summary{padding:6px 9px;cursor:pointer;font-weight:600;line-height:1.25;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-guidance[open]{max-height:130px;overflow:auto;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-primary-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:3px 0;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-primary-actions :is(input,select){min-width:0;max-width:100%;box-sizing:border-box;}',
    '.mc-rigid-review-dialog--phase6 [data-mode-a-rigid-search]{width:clamp(165px,17vw,260px);min-width:165px!important;}',
    '.mc-rigid-review-dialog--phase6 [data-mode-a-rigid-source]{width:clamp(145px,14vw,205px);}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-primary-actions button{white-space:nowrap;padding:7px 10px!important;min-height:33px;font-size:12px;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-columns-toggle{background:#172c48;color:#d7e6ff;border:1px solid #577293;border-radius:6px;cursor:pointer;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-more-actions{margin:2px 0 0;border:1px solid #283c55;border-radius:5px;color:#b2c9e6;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-more-actions > summary{cursor:pointer;padding:5px 8px;font-size:12px;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-extra-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:6px 8px 8px;max-height:140px;overflow:auto;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-more-actions:not([open]) > .mc-phase6-extra-actions{display:none!important;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-guidance:not([open]) > :not(summary){display:none!important;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-extra-actions button{font-size:12px;padding:6px 10px!important;min-height:31px;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-action-status:not(:empty){display:block;margin:5px 2px;font-size:12px;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-action-status:empty{display:none;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-columns-note{margin:4px 0!important;color:#a9bfda;font-size:11px;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-table-viewport{flex:1 1 0!important;min-height:150px;max-height:none!important;overscroll-behavior:contain;scrollbar-gutter:stable;border:1px solid #48617e;border-radius:6px;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-weight-table{width:100%;min-width:1320px;table-layout:fixed;border-collapse:separate;border-spacing:0;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-weight-table :is(th,td){box-sizing:border-box;vertical-align:top;padding:7px 8px;border-bottom:1px solid #253750;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-weight-table th{position:sticky;top:0;z-index:3;background:#1e293b;color:#f3f7ff;white-space:normal;text-align:left;font-size:12px;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-weight-table td{color:#d9e5f5;font-size:12px;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-weight-table tr:nth-child(even){background:#13223b;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-weight-table tr:focus-within{background:#203654;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-weight-table :is(th,td):nth-child(2){width:200px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-weight-table :is(th,td):nth-child(3){width:70px;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-weight-table :is(th,td):nth-child(4){width:86px;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-weight-table :is(th,td):nth-child(5){width:145px;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-weight-table :is(th,td):nth-child(6){width:195px;max-width:195px;overflow-wrap:anywhere;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-weight-table :is(th,td):nth-child(7){width:75px;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-weight-table :is(th,td):nth-child(8){width:118px;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-weight-table :is(th,td):nth-child(9){width:310px;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-weight-table :is(th,td):nth-child(15){width:105px;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-weight-table :is(th,td):nth-child(16){width:75px;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-weight-table :is(th,td):nth-child(19){width:85px;}',
    '.mc-rigid-review-dialog--phase6:not(.mc-phase6-show-all) .mc-phase6-weight-table :is(th,td):is(:nth-child(1),:nth-child(10),:nth-child(11),:nth-child(12),:nth-child(13),:nth-child(14),:nth-child(17),:nth-child(18),:nth-child(20),:nth-child(21),:nth-child(22)){display:none;}',
    '.mc-rigid-review-dialog--phase6.mc-phase6-show-all .mc-phase6-weight-table{min-width:2750px;width:max-content;table-layout:auto;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-dialog-footer{flex:0 0 auto!important;margin-top:7px!important;padding-top:9px!important;background:#0f172a;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-dialog-footer button{min-height:39px;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-missing-list{max-height:78px!important;overflow:auto;flex:0 0 auto;}',
    '.mc-rigid-review-dialog--phase6 .mc-phase6-bulk-review{position:absolute;top:65px;bottom:70px;left:14px;right:14px;max-height:none;overflow:auto;z-index:8;box-shadow:0 16px 40px #050b18;background:#11223a;}',
    '@media(max-width:720px){.mc-rigid-review-dialog--phase6{padding:8px!important;}.mc-rigid-review-dialog--phase6 .mc-phase6-primary-actions{gap:4px;}.mc-rigid-review-dialog--phase6 .mc-phase6-weight-table{min-width:1260px;}.mc-rigid-review-dialog--phase6 .mc-phase6-table-viewport{min-height:110px;}}',
    '@media(max-height:600px){.mc-rigid-review-dialog--phase6 .mc-phase6-guidance{display:none;}.mc-rigid-review-dialog--phase6 .mc-phase6-primary-actions button{padding:4px 7px!important;}.mc-rigid-review-dialog--phase6 .mc-phase6-more-actions > summary{padding:3px 8px;}}',
  ].join('\n');
  dialog.prepend(css);
}

function collectCurrentValues(overlay) {
  const weights = new Map();
  const skips = new Set();
  const ratings = new Map();
  overlay.querySelectorAll('.mc-rigid-review-input').forEach((input) => {
    const numeric = Number(input.value);
    if(input.dataset.rigidSkippedZero === 'true' && input.value === '0')
      skips.add(input.dataset.reviewId || '');
    if (input.value !== '' && Number.isFinite(numeric) && numeric > 0 &&
        input.dataset.rigidSuggestionDraft !== 'estimate')
      weights.set(input.dataset.reviewId || '', numeric);
  });
  overlay.querySelectorAll('.mc-rigid-review-rating-input').forEach((input) => {
    if (text(input.value)) ratings.set(input.dataset.reviewId || '', text(input.value));
  });
  return { weights, skips, ratings };
}


function bindCandidateButtons(overlay,rows){
  overlay.querySelectorAll('[data-mode-a-rigid-candidate]').forEach(button=>button.addEventListener('click',()=>{
    const index=Number(button.dataset.modeARigidCandidate);
    const input=overlay.querySelectorAll('.mc-rigid-review-input')[index];
    const choice=modeARigidSelectableSuggestions(rows[index])[Number(button.dataset.modeARigidOption)];
    if(!input||!choice||!Number.isFinite(choice.weight)||choice.weight<=0)return;
    delete input.dataset.rigidSkippedZero;
    stageRigidReviewProposal(input,{
      weight:choice.weight,approved:choice.approved,
      reference:choice.label+' · '+choice.method+
        (choice.referenceLengthMm===null?'':' · master L='+choice.referenceLengthMm+'mm'),
    });
    input.dataset.rigidChoiceIndex=button.dataset.modeARigidOption;
    button.closest('tr')?.querySelectorAll('[data-mode-a-rigid-candidate]').forEach(item=>{
      const selected=item===button;
      item.setAttribute('aria-pressed',selected?'true':'false');
      item.style.borderColor=selected?'#fbbf24':'#7c9bd2';
      item.style.background=selected?'#49370b':'#173a64';
    });
  }));
}

export function openModeAConsolidatedRigidWeightReviewPopup(entries = [],{phase6=false}={}) {
  const workingEntries = entries.map((entry) => ({ ...entry, issues: (entry.issues || [])
    .map(issue=>({...issue,phase6})) }));
  let rows = flattenModeARigidReviewEntries(workingEntries);
  if (!rows.length) return Promise.resolve({ cancelled: false, updates: {} });
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'model-converters-workflow-popup-overlay mc-rigid-review-overlay';
    overlay.innerHTML = popupMarkup(rows, workingEntries,{phase6});
    document.body.appendChild(overlay);
    if(phase6)installPhase6ReviewLayout(overlay);
    const body = overlay.querySelector('[data-mode-a-rigid-body]');
    const status = overlay.querySelector('[data-mode-a-rigid-status]');
    const summary = overlay.querySelector('[data-mode-a-rigid-summary]');
    const search = overlay.querySelector('[data-mode-a-rigid-search]');
    const source = overlay.querySelector('[data-mode-a-rigid-source]');
    const missingButton=overlay.querySelector('[data-mode-a-rigid-show-missing]');
    const missingList=overlay.querySelector('[data-mode-a-rigid-missing-list]');
    let missingOnly=false;
    let reviewOnly=false;
    let exactOnly=false;
    const reviewButton=overlay.querySelector('[data-mode-a-rigid-show-unreviewed]');
    const openBulkButton=overlay.querySelector('[data-mode-a-rigid-open-review]');
    const reviewPanel=overlay.querySelector('[data-mode-a-rigid-bulk-review-panel]');
    const reviewPanelSummary=overlay.querySelector('[data-mode-a-rigid-bulk-review-summary]');
    const reviewPanelExamples=overlay.querySelector('[data-mode-a-rigid-bulk-review-examples]');
    const reviewAttest=overlay.querySelector('[data-mode-a-rigid-bulk-attest]');
    const reviewConfirm=overlay.querySelector('[data-mode-a-rigid-confirm-bulk-review]');
    const hideBulkReview=()=>{
      if(reviewPanel)reviewPanel.style.display='none';
      if(reviewAttest)reviewAttest.checked=false;
      if(reviewConfirm)reviewConfirm.disabled=true;
    };
    const initialRatings = new Map([...overlay.querySelectorAll('.mc-rigid-review-rating-input')]
      .map(input=>[input.dataset.reviewId||'',text(input.value)]));
    const setStatus = (message, bad = false) => { if (status) { status.textContent = message; status.style.color = bad ? '#ef4444' : '#10b981'; } };
    const missingRows=()=>[...overlay.querySelectorAll('[data-mode-a-rigid-review-row]')].filter(tr=>{
      const input=tr.querySelector('.mc-rigid-review-input');
      const weight=input?.value === '' ? null : Number(input?.value);
      return !(Number.isFinite(weight) && weight>0) &&
        !(input?.dataset.rigidSkippedZero==='true' && input?.value==='0');
    });
    const pendingReviewRows=()=>[...overlay.querySelectorAll('[data-mode-a-rigid-review-row]')].filter(tr=>{
      const input=tr.querySelector('.mc-rigid-review-input');
      return input && input.value!=='' && Number(input.value)>0 &&
        rigidReviewProposalNeedsVerification(input);
    });
    const updateReviewCounts=()=>{
      const pending=pendingReviewRows().length;
      const approveAll=overlay.querySelector('[data-phase6-approve-all]');
      if(approveAll){
        approveAll.textContent='🛡 Approve all drafts ('+pending+')';
        approveAll.disabled=pending===0;
      }
      if(reviewButton)reviewButton.textContent=(reviewOnly?'Show all':'Show pending reviews')+' ('+pending+')';
      if(openBulkButton){
        openBulkButton.textContent='Review draft weights ('+pending+')';
        openBulkButton.disabled=pending===0;
      }
      return pending;
    };
    const showBulkReview=()=>{
      const pending=pendingReviewRows();
      if(!pending.length){hideBulkReview();return;}
      if(reviewPanelSummary)reviewPanelSummary.textContent=
        pending.length+' unapproved physical-component masses still require engineering acceptance. '+
        'They are estimated draft values; the matching master does not independently establish actual mass. '+
        'Review source references and edit any uncertain estimates before using the bulk attestation.';
      if(reviewPanelExamples) {
        const byId=new Map(rows.map(issue=>[issue.reviewId,issue]));
        const drafts=pending.map(tr=>{
          const input=tr.querySelector('.mc-rigid-review-input');
          const issue=byId.get(input?.dataset.reviewId);
          return {
            fileName:issue?.fileName||issue?.sourceId||'XML',
            branchName:issue?.branchName||'-',
            nodeNumber:issue?.nodeNumberDisplay||issue?.nodeNumber||'? ',
            componentRef:(issue?.componentRefNo||'NO REF')+'_'+(issue?.endpoint||'?'),
            weightKg:input?.value||'',
            dtxr:issue?.dtxr||'DTXR missing',
          };
        });
        reviewPanelExamples.innerHTML=modeABulkReviewTableMarkup(drafts);
      }
      if(reviewPanel){
        // The mass attestation is a separate step laid over the TABLE, not
        // the toolbar. Keep Approve all / Cancel and matching actions
        // unobstructed, including when More matching tools is expanded.
        if(phase6){
          const dialog=overlay.querySelector('.mc-rigid-review-dialog');
          const toolbar=overlay.querySelector('.mc-phase6-toolbar');
          if(dialog && toolbar){
            const top=toolbar.getBoundingClientRect().bottom-
              dialog.getBoundingClientRect().top+6;
            reviewPanel.style.top=Math.max(70,Math.ceil(top))+'px';
          }
        }
        reviewPanel.style.display='block';
      }
      if(reviewAttest)reviewAttest.checked=false;
      if(reviewConfirm)reviewConfirm.disabled=true;
      reviewPanel?.scrollIntoView?.({block:'nearest'});
    };
    const refreshMissingList=()=>{
      const missing=missingRows();
      if(missingButton)missingButton.textContent=(missingOnly?'Show all':'Show missing')+' ('+missing.length+')';
      if(missingList){
        // Do not fill the whole dialog with 114 rows on initial load.
        // The full list is accessible through Show missing and source search.
        missingList.style.display=missing.length && (missingOnly||missing.length<=10)?'block':'none';
        missingList.textContent=missing.length
          ? 'Missing '+missing.length+' physical weights (click Show missing to isolate).\n'+
            missing.slice(0,12).map((tr,index)=>{
              const issue=rows.find(row=>row.reviewId===tr.dataset.reviewId);
              return (index+1)+'. '+(issue?.fileName||issue?.sourceId||'XML')+
                ' | '+(issue?.branchName||'-')+
                ' | node '+(issue?.nodeNumberDisplay||issue?.nodeNumber||'-')+
                ' | ref '+(issue?.componentRefNo||'missing source ref')+
                '_'+(issue?.endpoint||'?')+
                ' | '+(issue?.dtxr||'DTXR unavailable');
            }).join('\n')+
            (missing.length>12?'\n… '+(missing.length-12)+
              ' additional missing rows; use Show missing or search by source reference.':'')
          : '';
      }
      return missing;
    };
    const filter = () => {
      if(phase6){
        let eligible=0;
        for(const tr of overlay.querySelectorAll('[data-mode-a-rigid-review-row]')){
          const issue=rows.find(row=>row.reviewId===tr.dataset.reviewId);
          const input=tr.querySelector('.mc-rigid-review-input');
          const ref=issue&&phase6ComparableReference(issue);
          const pct=ref?phase6ReferenceErrorPercent(input?.value,ref.kg):null;
          const errorCell=tr.querySelector('[data-phase6-error-pct]');
          if(errorCell){
            errorCell.textContent=pct===null?'—':(pct>=0?'+':'')+pct.toFixed(1)+'%';
            errorCell.style.color=pct!==null && Math.abs(pct)>PHASE6_DEVIATION_LIMIT_PCT
              ?'#fbbf24':'#cbd5e1';
          }
          if(input?.value===input?.dataset.originalWeight &&
             !input?.dataset.rigidSuggestionDraft &&
             phase6BatchDeviationDraft(issue, input?.value))eligible++;
        }
        const deviationButton=overlay.querySelector('[data-phase6-deviation40]');
        if(deviationButton){
          deviationButton.textContent='Stage |Error| >40% ('+eligible+')';
          deviationButton.disabled=eligible===0;
        }
      }
      const q = text(search?.value).toLowerCase();
      const sourceId = source?.value || '';
      const missing=missingRows();
      const pending=pendingReviewRows();
      if(missingOnly && !missing.length)missingOnly=false;
      if(reviewOnly && !pending.length)reviewOnly=false; // zero missing must not hide every row
      const missingSet=new Set(missingOnly?missing:[]);
      const reviewSet=new Set(reviewOnly?pending:[]);
      overlay.querySelectorAll('[data-mode-a-rigid-review-row]').forEach((tr) => {
        const show = (!sourceId || tr.dataset.sourceId === sourceId) &&
          (!q || (tr.dataset.search || '').includes(q)) &&
          (!missingOnly || missingSet.has(tr)) &&
          (!reviewOnly || reviewSet.has(tr)) &&
          (!exactOnly || (()=>{const issue=rows.find(x=>x.reviewId===tr.dataset.reviewId);
            return !issue?.mapped && Boolean(phase6QualifiedExactCandidate(issue||{}));})());
        tr.style.display = show ? '' : 'none';
      });
      refreshMissingList();
      updateReviewCounts();
      if(phase6){
        const counters=overlay.querySelector('[data-phase6-popup-counters]');
        if(counters){
          const all=[...overlay.querySelectorAll('[data-mode-a-rigid-review-row]')];
          const mapped=all.filter(tr=>tr.querySelector('.mc-rigid-review-input')?.dataset.originalWeight!=='').length;
          const skipped=all.filter(tr=>tr.querySelector('.mc-rigid-review-input')?.dataset.rigidSkippedZero==='true').length;
          counters.textContent='🗂 '+all.length+' components   ·   ✅ '+mapped+
            ' existing masses   ·   ✏️ '+pendingReviewRows().length+
            ' review drafts   ·   ⚠️ '+missingRows().length+
            ' missing   ·   ⏭ '+skipped+' intentional skips';
        }
      }
    };
    const draw = (preserve = new Map(), skipped = new Set()) => {
      hideBulkReview();
      reviewOnly=false;
      missingOnly=false;
      exactOnly=false;
      rows = flattenModeARigidReviewEntries(workingEntries);
      if (body) body.innerHTML = rows.map(rowMarkup).join('');
      overlay.querySelectorAll('.mc-rigid-review-input').forEach((input) => {
        const id=input.dataset.reviewId||'';
        if(preserve.has(id)) input.value=preserve.get(id);
        if(skipped.has(id)){input.value='0';input.dataset.rigidSkippedZero='true';
          input.title='Intentionally skipped: 0 kg, no source mass assigned';}
      });
      if (summary) summary.textContent = `${rows.length} rigid node(s) across ${new Set(rows.map((row) => row.sourceId)).size} XML file(s).`;
      bindCandidateButtons(overlay, rows);
      filter();
    };
    bindCandidateButtons(overlay, rows);
    if(phase6){
      overlay.addEventListener('click',event=>{
        const button=event.target?.closest?.('[data-phase6-row-edit]');
        if(!button)return;
        const input=button.closest('tr')?.querySelector('.mc-rigid-review-input');
        input?.focus();
        input?.select?.();
      });
      let dtxrMode=false;
      const originalOverrideRatings=new Map(workingEntries.map(entry=>
        [entry.sourceId,{...(entry.config?.overrides?.rating||{})}]));
      overlay.querySelector('[data-phase6-dtxr]')?.addEventListener('click',()=>{
        dtxrMode=!dtxrMode;
        let changed=0;
        for(const tr of overlay.querySelectorAll('[data-mode-a-rigid-review-row]')){
          const ratingInput=tr.querySelector('.mc-rigid-review-rating-input');
          if(!ratingInput)continue;
          const original=initialRatings.get(ratingInput.dataset.reviewId||'')||'';
          const dtxr=extractXmlCiiRatingFromDtxr(tr.children[5]?.textContent||'');
          const next=dtxrMode?dtxr:original;
          if(dtxrMode&&!next)continue;
          if(ratingInput.value!==next){ratingInput.value=next;changed++;}
        }
        if(!dtxrMode){
          for(const entry of workingEntries){
            entry.config={...entry.config,overrides:{...(entry.config?.overrides||{}),
              rating:{...(originalOverrideRatings.get(entry.sourceId)||{})}}};
          }
        }
        const button=overlay.querySelector('[data-phase6-dtxr]');
        if(button)button.textContent=dtxrMode?'Use Rating shown in Preview':'Use Rating as per DTXR';
        setStatus(changed+' Rating field(s) switched to '+(dtxrMode?'DTXR evidence':'original Preview')+
          '; suggestions refreshing. Rating changes are not committed until Save.',false);
        overlay.querySelector('[data-mode-a-rigid-refresh]')?.click();
      });
      overlay.querySelector('[data-phase6-approve-all]')?.addEventListener('click',()=>{
        // Approval requires the same explicit attestation checkbox and separate
        // confirmation as "Review draft weights". No implicit batch approval.
        showBulkReview();
      });
      overlay.querySelector('[data-phase6-deviation40]')?.addEventListener('click',()=>{
        let staged=0;
        rows.forEach((issue,index)=>{
          const input=overlay.querySelectorAll('.mc-rigid-review-input')[index];
          if(!input || input.value!==input.dataset.originalWeight ||
             input.dataset.rigidSuggestionDraft)return;
          const draft=phase6BatchDeviationDraft(issue,input.value);
          if(draft && stageRigidReviewProposal(input,draft))staged++;
        });
        hideBulkReview();filter();
        setStatus(staged+' deviation(s) above ±40% staged as unapproved reference drafts. '+
          'Verify physical masses and use Approve all drafts before Save (No Run). No output generated.',false);
      });
      overlay.querySelector('[data-phase6-nearest]')?.addEventListener('click',()=>{
        let updated=0;
        rows.forEach((row,index)=>{
          const input=overlay.querySelectorAll('.mc-rigid-review-input')[index];
          if(!input || input.value!=='')return;
          const proposal=proposedRigidReviewWeight(row);
          if(proposal && stageRigidReviewProposal(input,proposal))updated++;
        });
        hideBulkReview();filter();
        setStatus(updated+' blank rows filled as review drafts; existing source masses preserved. No value saved.',false);
      });
      const exact=phase6QualifiedExactCandidate;
      overlay.querySelector('[data-phase6-find-exact]')?.addEventListener('click',()=>{
        exactOnly=!exactOnly;
        if(exactOnly){missingOnly=false;reviewOnly=false;}
        const button=overlay.querySelector('[data-phase6-find-exact]');
        if(button)button.textContent=exactOnly?'Show All Weights':'Find Exact Weight Matches';
        filter();
        const matches=rows.filter(row=>!row.mapped&&exact(row)).length;
        setStatus(matches+' source-approved exact match(es) identified. Catalog-perfect estimates without physical mass approval remain Review.',false);
      });
      overlay.querySelector('[data-phase6-fill-similar]')?.addEventListener('click',()=>{
        const groups=new Map();
        for(let i=0;i<rows.length;i++){
          const row=rows[i],match=exact(row);
          if(!match || row.mapped)continue;
          const key=[row.componentType,row.boreMm,row.rating,
            Number(row.lengthMm).toFixed(3),
            String(match.source.typeDesc||''),match.weight].join('|');
          const list=groups.get(key)||[];
          list.push(i);groups.set(key,list);
        }
        let updated=0;
        for(const indices of groups.values()){
          if(indices.length<2)continue;
          for(const index of indices){
            const input=overlay.querySelectorAll('.mc-rigid-review-input')[index];
            if(!input || input.value!=='')continue;
            const verified=exact(rows[index]);
            if(verified && stageRigidReviewProposal(input,{
              weight:verified.weight,approved:true,reference:
                String(verified.source.typeDesc||'Source-approved exact weight'),
              method:'source-approved-exact',
            }))updated++;
          }
        }
        hideBulkReview();filter();
        setStatus(updated+' grouped exact source-approved weights staged. Mapped/manual masses were not overwritten.',false);
      });
    }
    filter(); // Show accurate missing-row count and source-ref trace immediately.
    reviewButton?.addEventListener('click',()=>{
      exactOnly=false;
      const exactButton=overlay.querySelector('[data-phase6-find-exact]');
      if(exactButton)exactButton.textContent='Find Exact Weight Matches';
      reviewOnly=!reviewOnly;
      if(reviewOnly)missingOnly=false;
      filter();
      if(reviewOnly)pendingReviewRows()[0]?.scrollIntoView?.({block:'nearest'});
    });
    openBulkButton?.addEventListener('click',showBulkReview);
    reviewAttest?.addEventListener('change',()=>{
      if(reviewConfirm)reviewConfirm.disabled=!reviewAttest.checked || !pendingReviewRows().length;
    });
    overlay.querySelector('[data-mode-a-rigid-close-bulk-review]')?.addEventListener('click',hideBulkReview);
    reviewConfirm?.addEventListener('click',()=>{
      if(!reviewAttest?.checked){
        setStatus('Independent mass verification acknowledgment is required. No values have been approved.',true);
        return;
      }
      const pending=pendingReviewRows();
      if(!pending.length){hideBulkReview();filter();return;}
      for(const tr of pending){
        const input=tr.querySelector('.mc-rigid-review-input');
        if(!input || !rigidReviewProposalNeedsVerification(input))continue;
        input.dataset.rigidReviewMethod='EXPLICIT_BULK_OWNER_ATTESTATION';
      }
      hideBulkReview();
      reviewOnly=false;
      filter();
      setStatus('Explicit independent review acknowledged for '+pending.length+
        ' estimated physical-component masses. '+
        (phase6?'Click Save Reviewed Weights (No Run) to commit source-specific masses. ':
          'Click Apply Weights and Run All Models to continue. ')+
        'No output has been produced yet.',false);
    });
    overlay.addEventListener('change',event=>{
      if(event.target?.matches?.('[data-mode-a-rigid-choice]') ||
         event.target?.matches?.('.mc-rigid-review-input')){
        hideBulkReview(); // any changed candidate invalidates a previous blanket confirmation
        filter();
      }
    });
    overlay.addEventListener('click',event=>{
      if(event.target?.closest?.('[data-mode-a-rigid-apply-suggestions], [data-mode-a-rigid-candidate]')){
        hideBulkReview(); // a replacement candidate invalidates earlier bulk attestation
        filter();
      }
    });
    overlay.addEventListener('input', event=>{
      if(event.target?.matches?.('.mc-rigid-review-input')){
        clearRigidReviewProposal(event.target);
        delete event.target.dataset.rigidSkippedZero;
        delete event.target.dataset.rigidChoiceIndex;
        delete event.target.dataset.rigidReviewMethod;
        hideBulkReview();
        filter();
      }
    });
    missingButton?.addEventListener('click',()=>{
      exactOnly=false;
      const exactButton=overlay.querySelector('[data-phase6-find-exact]');
      if(exactButton)exactButton.textContent='Find Exact Weight Matches';
      missingOnly=!missingOnly;
      if(missingOnly)reviewOnly=false;
      filter();
      if(missingOnly)missingRows()[0]?.scrollIntoView?.({block:'nearest'});
    });
    overlay.querySelector('[data-mode-a-rigid-skip-blanks]')?.addEventListener('click',()=>{
      const missing=missingRows();
      for(const tr of missing){
        const input=tr.querySelector('.mc-rigid-review-input');
        if(!input || input.value!=='')continue; // never overwrite a typed zero or manual positive
        clearRigidReviewProposal(input);
        input.value='0';
        input.dataset.rigidSkippedZero='true';
        input.title='EXPLICIT 0 kg SKIP — no verified physical-component mass; no source mass assigned.';
        input.style.borderColor='#fbbf24';
      }
      const count=missing.filter(tr=>tr.querySelector('.mc-rigid-review-input')?.dataset.rigidSkippedZero==='true').length;
      filter();
      setStatus(count+' blank row(s) marked 0 kg SKIPPED. '+pendingReviewRows().length+
        ' estimated masses still require a single explicit batch confirmation. '+
        'No skipped zero is an approved physical source mass.',false);
    });
    overlay.querySelector('[data-mode-a-rigid-apply-suggestions]')?.addEventListener('click',()=>{
      let filled=0,skipped=0;
      rows.forEach((row,index)=>{
        const input=overlay.querySelectorAll('.mc-rigid-review-input')[index];
        const proposal=proposedRigidReviewWeight(row);
        if(!input || !proposal || (input.value && !input.dataset.rigidSuggestionDraft)) {skipped++;return;}
        if(stageRigidReviewProposal(input,proposal))filled++; else skipped++;
      });
      hideBulkReview();
      filter();
      setStatus(`Prefilled ${filled} review draft(s), ${missingRows().length} blank(s) remaining. `+
        `${pendingReviewRows().length} estimated masses require explicit independent review. `+
        'Use Show pending reviews, or Review draft weights after checking the source. No values saved.',filled===0);
    });
    search?.addEventListener('input', filter);
    source?.addEventListener('change', filter);

    overlay.querySelector('[data-mode-a-rigid-fill-exact]')?.addEventListener('click', () => {
      let count = 0;
      rows.forEach((row, index) => {
        const best = row.candidates?.[0];
        const value = Number(best?.suggestedWeight ?? best?.selectedWeight ?? best?.weight);
        if (!best?.preferred || !isApprovedPhysicalMassCandidate(best, value)) return;
        const input = overlay.querySelectorAll('.mc-rigid-review-input')[index];
        if (input && (!phase6 || input.value==='') &&
            stageRigidReviewProposal(input,proposedRigidReviewWeight(row))) count += 1;
      });
      hideBulkReview();
      filter();
      setStatus(`Filled ${count} independently approved source mass(es). `+
        (phase6?'Review remaining drafts before Save (No Run).':
          'Review remaining drafts before Run.'), false);
    });

    overlay.querySelector('[data-mode-a-rigid-refresh]')?.addEventListener('click', async () => {
      const button = overlay.querySelector('[data-mode-a-rigid-refresh]');
      if (button) button.disabled = true;
      setStatus('Refreshing suggestions across XML files…', false);
      const current = collectCurrentValues(overlay);
      for (const entry of workingEntries) {
        const sourceRatings = {};
        rows.filter((row) => row.sourceId === entry.sourceId).forEach((row) => {
          const value = current.ratings.get(row.reviewId);
          if (value) sourceRatings[row.key] = value;
        });
        const config = {
          ...(entry.config || {}),
          overrides: {
            ...(entry.config?.overrides || {}),
            rating: { ...(entry.config?.overrides?.rating || {}), ...sourceRatings },
          },
        };
        entry.config = config;
        entry.issues = (await collectModeARigidWeightReviewIssues(entry.state, config,
          {includeMapped:phase6,includeSkipped:phase6})).map(issue=>({...issue,phase6}));
      }
      draw(current.weights,current.skips);
      setStatus(`Suggestions refreshed for ${workingEntries.length} XML file(s).`, false);
      if (button) button.disabled = false;
    });

    overlay.querySelector('[data-mode-a-rigid-cancel]')?.addEventListener('click', () => {
      overlay.remove();
      resolve({ cancelled: true, updates: {} });
    });

    overlay.querySelector('[data-mode-a-rigid-apply]')?.addEventListener('click', () => {
      const updates = {};
      const missing = [], unreviewed = [], skipped = [];
      let editedMapped=0;
      overlay.querySelectorAll('.mc-rigid-review-input').forEach((input) => {
        const sourceId = input.dataset.sourceId || '';
        const key = input.dataset.issueKey || '';
        const numeric = input.value==='' ? NaN : Number(input.value);
        const original=Number(input.dataset.originalWeight);
        const wasMapped=input.dataset.originalWeight!=='';
        if(phase6 && wasMapped && Number.isFinite(numeric) &&
            Math.abs(numeric-original)<1e-9 &&
            input.dataset.rigidSuggestionDraft!=='estimate')return;
        if(phase6 && input.value==='')return; // Phase 6 accepts partial edits; Run never does.
        if(input.dataset.rigidSkippedZero==='true' && input.value==='0'){
          updates[sourceId] ||= {ratingsByKey:{},weightsByKey:{},skippedByKey:{}};
          updates[sourceId].skippedByKey ||= {};
          updates[sourceId].skippedByKey[key]={
            skipped:true,weightKg:0,reason:'EXPLICIT_ZERO_MASS_SKIP_NO_SOURCE_AUTHORITY',
          };
          skipped.push(sourceId+':'+key);
          input.style.borderColor='#fbbf24';
          return;
        }
        if (!Number.isFinite(numeric) || numeric <= 0) {
          missing.push(`${sourceId}:${key}`);
          input.style.borderColor = '#ef4444';
          return;
        }
        if(rigidReviewProposalNeedsVerification(input)){
          unreviewed.push(`${sourceId}:${key}`);
          input.style.borderColor='#d9a441';
          return;
        }
        input.style.borderColor = '#31455f';
        updates[sourceId] ||= { ratingsByKey: {}, weightsByKey: {} };
        updates[sourceId].weightsByKey[key] = numeric;
        if(phase6 && wasMapped && Math.abs(numeric-original)>1e-9)editedMapped++;
        if(input.dataset.rigidSuggestionDraft==='estimate'){
          if(input.dataset.rigidReviewMethod!=='EXPLICIT_BULK_OWNER_ATTESTATION')
            throw new Error('Unconfirmed estimated mass passed batch review gate: '+key);
          updates[sourceId].reviewReceiptsByKey ||= {};
          const issue=rows.find(row=>row.reviewId===input.dataset.reviewId);
          updates[sourceId].reviewReceiptsByKey[key]={
            reviewed:true,reviewMethod:'EXPLICIT_BULK_OWNER_ATTESTATION',
            weightKg:numeric,
            sourceComponentRef:issue?.componentRefNo||'',
            sourceEndpoint:issue?.endpoint||'',
            statement:'Reviewer confirms independent physical-component mass verification',
          };
        }
      });
      overlay.querySelectorAll('.mc-rigid-review-rating-input').forEach((input) => {
        const sourceId = input.dataset.sourceId || '';
        const key = input.dataset.issueKey || '';
        if (!text(input.value) || text(input.value) === initialRatings.get(input.dataset.reviewId || '')) return;
        updates[sourceId] ||= { ratingsByKey: {}, weightsByKey: {} };
        updates[sourceId].ratingsByKey[key] = text(input.value);
      });
      if(missing.length || unreviewed.length){
        missingOnly=missing.length>0;
        reviewOnly=missing.length===0 && unreviewed.length>0;
        filter();
        if(unreviewed.length && !missing.length) showBulkReview();
        const firstMissing=missing.length?missingRows()[0]:null;
        setStatus(
          (missing.length?'Enter a positive weight for '+missing.length+
              ' missing row(s) or choose explicit Skip blank; Show missing locates the source. '
            :'No blank weights remain. ')+
          (unreviewed.length?unreviewed.length+' estimate draft(s) are NOT independently reviewed. '+
            'Use the explicit Review draft weights confirmation. ':'')+
          skipped.length+' intentional 0 kg skip(s). Nothing was applied.',true);
        // After a 0-missing/109-unreviewed Apply, keep the explicit
        // confirmation panel in view rather than scrolling past it to row 1.
        firstMissing?.scrollIntoView?.({block:'nearest'});
        return;
      }
      overlay.remove();
      resolve({ cancelled: false, updates,editedMapped,phase6 });
    });
  });
}
