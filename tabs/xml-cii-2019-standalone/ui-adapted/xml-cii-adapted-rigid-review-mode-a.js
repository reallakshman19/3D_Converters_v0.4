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

const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attr = (value) => esc(value).replace(/'/g, '&#39;');
const text = (value) => value === undefined || value === null ? '' : String(value).trim();

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

function rowMarkup(issue, rowIndex) {
  const best = issue.candidates?.[0] || null;
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
      <div data-rigid-review-source-ref style="font-size:10px;color:#9fb5d1;overflow-wrap:anywhere;">${esc(issue.componentRefNo || 'No ref')}${issue.endpoint ? '_' + esc(issue.endpoint) : ''}</div></td>
    <td title="${attr(issue.dtxrSourcePath || '')}" style="padding:7px;border-bottom:1px solid rgba(148,163,184,.1);min-width:180px;">${esc(issue.dtxr || 'Not found')}</td>
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
    <td>${esc(formatValveHint(issue.nodeHint)||'—')}</td>
    <td>${esc(issue.mapped?issue.weight+' kg':(issue.existingSkipped?'0 kg skip':'—'))}</td>
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
    <div style="background:#2a210b;border:1px solid #7c5a18;color:#ffe7a3;padding:9px;border-radius:6px;font-size:12px;margin-bottom:10px;">One review gate covers all enabled XML models. Source identity is preserved; Rating and Weight changes are written only to that XML. “Use All Exact Suggestions” fills only independently approved source masses. Empirical estimates are review drafts only. Apply All Suggestions prepopulates suggested kg but does not approve or save them. To proceed, independently verify each mass and tick Reviewed, or use Review pending drafts for an explicit bulk engineering acknowledgment. Unreviewed values will not be written. Enter mass in kg; the optional kg→N CII export conversion applies ×10 only at output. “Skip blank” explicitly marks empty rows as 0 kg with no verified mass (logged separately; zero is not approved source mass). Use “Show missing” to see source refs and locate outstanding rows.</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">
      <input type="search" data-mode-a-rigid-search placeholder="Search source / branch / node / component ref..." style="min-width:250px;padding:6px;background:#0b1220;color:#e2e8f0;border:1px solid #475569;border-radius:5px;">
      <select data-mode-a-rigid-source style="padding:6px;background:#0b1220;color:#e2e8f0;border:1px solid #475569;border-radius:5px;"><option value="">All XML files</option>${sourceOptions}</select>
      <button type="button" data-mode-a-rigid-refresh style="cursor:pointer;background:#1e293b;border:1px solid #334155;color:#cbd5e1;border-radius:6px;padding:7px 12px;">Refresh Suggestions</button>
      <button type="button" data-mode-a-rigid-show-missing title="Filter to rows requiring positive weight or explicit skip" style="cursor:pointer;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:7px 12px;">Show missing (0)</button>
       <button type="button" data-mode-a-rigid-skip-blanks title="Explicitly mark remaining blank physical components as 0 kg (skipped, no source mass assigned). Never creates an approved weight." style="cursor:pointer;background:#2b3342;color:#e2e8f0;border:1px solid #475569;border-radius:6px;padding:7px 12px;">Skip blank</button>
       <button type="button" data-mode-a-rigid-apply-suggestions style="cursor:pointer;background:#43330f;color:#ffe7a3;border:1px solid #ad8129;border-radius:6px;padding:7px 12px;">Apply All Suggestions</button>
       <button type="button" data-mode-a-rigid-show-unreviewed title="Locate source rows whose estimated masses still need approval" style="cursor:pointer;background:#1e293b;border:1px solid #475569;color:#e2e8f0;border-radius:6px;padding:7px 12px;">Show pending reviews (0)</button>
       <button type="button" data-mode-a-rigid-open-review title="Explicitly acknowledge independently verified estimated masses before final Apply" style="cursor:pointer;background:#1d3452;border:1px solid #5377ae;color:#e9f4ff;border-radius:6px;padding:7px 12px;">Review draft weights (0)</button>
      ${phase6?'<button type="button" data-phase6-dtxr style="padding:7px 12px;background:#1d3452;color:#e9f4ff;border:1px solid #5377ae;border-radius:6px;cursor:pointer;" title="Explicitly rerank suggestions by DTXR Rating; click again to restore original Preview Rating">Use Rating as per DTXR</button><button type="button" data-phase6-nearest style="padding:7px 12px;background:#43330f;color:#ffe7a3;border:1px solid #ad8129;border-radius:6px;cursor:pointer;" title="Fill blank weights only, without replacing an existing approved or manual mass">Apply nearest suggestions</button><button type="button" data-phase6-find-exact style="padding:7px 12px;background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:6px;cursor:pointer;" title="List source-approved exact candidates; catalog-perfect scores are not physical-mass approval">Find Exact Weight Matches</button><button type="button" data-phase6-fill-similar style="padding:7px 12px;background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:6px;cursor:pointer;" title="Fill grouped source-approved exact candidates only, never overwrite mapped rows">Fill Similar Exact</button>':''}
      <button type="button" data-mode-a-rigid-fill-exact style="cursor:pointer;background:#1e293b;border:1px solid #334155;color:#cbd5e1;border-radius:6px;padding:7px 12px;">Use All Exact Suggestions</button>
      <span data-mode-a-rigid-status role="status" aria-live="polite" style="font-size:12px;color:#94a3b8;flex-basis:100%;"></span>
    </div>
    <div data-mode-a-rigid-missing-list role="status" style="display:none;max-height:118px;overflow:auto;font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere;background:#281b11;border:1px solid #855328;color:#fbd38d;border-radius:6px;padding:8px;margin:0 0 8px;"></div>
    <div data-mode-a-rigid-bulk-review-panel style="display:none;background:#11223a;border:2px solid #7298ca;color:#edf6ff;border-radius:8px;padding:14px;margin:0 0 12px;">
      <div style="font-weight:700;font-size:15px;">Independent mass review required before Run</div>
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
    <div style="overflow:auto;max-height:55vh;border:1px solid rgba(148,163,184,.15);border-radius:6px;"><table style="border-collapse:collapse;font-size:12px;width:100%;text-align:left;"><thead><tr style="background:#1e293b;color:#fff;position:sticky;top:0;z-index:2;"><th style="padding:7px;background:#1e293b;">Source XML</th><th style="padding:7px;">Branch</th><th style="padding:7px;">Bore</th><th style="padding:7px;">Rating</th><th style="padding:7px;">Node</th><th style="padding:7px;">DTXR</th><th style="padding:7px;">Length</th><th style="padding:7px;">Manual Weight (kg)</th><th style="padding:7px;">Nearest Suggestions</th>
      <th style="padding:7px;">Line Key</th><th style="padding:7px;">Component Type</th>
      <th style="padding:7px;">Valve Hint</th><th style="padding:7px;">Current Weight</th>
      <th style="padding:7px;">Status</th><th style="padding:7px;">Score</th>
      <th style="padding:7px;">Candidate Type</th><th style="padding:7px;">Action</th>
      </tr></thead><tbody data-mode-a-rigid-body>${rows.map(rowMarkup).join('')}</tbody></table></div>
    <div style="display:flex;justify-content:flex-end;margin-top:14px;border-top:1px solid #253a55;padding-top:14px;"><button type="button" data-mode-a-rigid-apply style="cursor:pointer;background:#1e4ed8;border:none;color:#fff;border-radius:6px;padding:9px 18px;font-weight:700;">${phase6?'Save Reviewed Weights (No Run)':'Apply Weights and Run All Models'}</button></div>
  </div>`;
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
    const body = overlay.querySelector('[data-mode-a-rigid-body]');
    const status = overlay.querySelector('[data-mode-a-rigid-status]');
    const summary = overlay.querySelector('[data-mode-a-rigid-summary]');
    const search = overlay.querySelector('[data-mode-a-rigid-search]');
    const source = overlay.querySelector('[data-mode-a-rigid-source]');
    const missingButton=overlay.querySelector('[data-mode-a-rigid-show-missing]');
    const missingList=overlay.querySelector('[data-mode-a-rigid-missing-list]');
    let missingOnly=false;
    let reviewOnly=false;
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
      if(reviewPanel)reviewPanel.style.display='block';
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
          (!reviewOnly || reviewSet.has(tr));
        tr.style.display = show ? '' : 'none';
      });
      refreshMissingList();
      updateReviewCounts();
    };
    const draw = (preserve = new Map(), skipped = new Set()) => {
      hideBulkReview();
      reviewOnly=false;
      missingOnly=false;
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
      const exact=(row)=>{
        const best=row.candidates?.[0];
        const weight=Number(best?.suggestedWeight??best?.selectedWeight??best?.weight);
        const length=Number(row.lengthMm),masterLength=Number(best?.rowLength);
        return best?.preferred===true && Number.isFinite(weight)&&weight>0 &&
          (!Number.isFinite(masterLength)||Math.abs(masterLength-length)<=1e-6) &&
          isApprovedPhysicalMassCandidate(best,weight) ? {weight,source:best} : null;
      };
      overlay.querySelector('[data-phase6-find-exact]')?.addEventListener('click',()=>{
        const matches=rows.filter(row=>!row.mapped&&exact(row)).length;
        setStatus(matches+' source-approved exact match(es) available. Catalog-perfect estimates without independent mass authority remain drafts.',false);
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
            if(stageRigidReviewProposal(input,proposedRigidReviewWeight(rows[index])))updated++;
          }
        }
        hideBulkReview();filter();
        setStatus(updated+' grouped exact source-approved weights staged. Mapped/manual masses were not overwritten.',false);
      });
    }
    filter(); // Show accurate missing-row count and source-ref trace immediately.
    reviewButton?.addEventListener('click',()=>{
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
        ' estimated physical-component masses. Click Apply Weights and Run All Models to continue. '+
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
      setStatus(`Filled ${count} independently approved source mass(es). Review remaining drafts before Run.`, false);
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
