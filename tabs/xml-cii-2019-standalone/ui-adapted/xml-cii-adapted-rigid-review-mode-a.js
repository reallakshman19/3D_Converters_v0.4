import { isApprovedPhysicalMassCandidate } from '../../../converters/xml-cii2019-core/physical-mass-approval.js';
import { proposedRigidReviewWeight, stageRigidReviewProposal, clearRigidReviewProposal, rigidReviewProposalNeedsVerification, isRigidWeightReviewEligibleIssue } from './xml-cii-adapted-rigid-review-prefill.js';
import { resolveStandaloneWeightReviewRating, standaloneWeightReviewRatingInfo } from './xml-cii-adapted-weight-rating-authority.js';
import { collectXmlCiiZeroRigidWeightIssues, reconcileXmlCiiWeightMatchSourceBores } from '../../../converters/xml-cii2019-core/weight-match-model.js?v=20261107-glrd-bore-family-r2';
import { applyXmlCiiFlangeWeightFallbackToIssue } from '../../../converters/xml-cii2019-core/flange-weight-fallback.js';
import { rankXmlCiiWeightCandidates } from '../../../converters/xml-cii2019-core/weight-valve-hints.js?v=20261107-glrd-bore-family-r2';
import { flattenModeARigidReviewEntries } from './xml-cii-adapted-rigid-review-mode-a-state.js';

const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attr = (value) => esc(value).replace(/'/g, '&#39;');
const text = (value) => value === undefined || value === null ? '' : String(value).trim();

export async function collectModeARigidWeightReviewIssues(state = {}, config = {}) {
  return reconcileXmlCiiWeightMatchSourceBores(collectXmlCiiZeroRigidWeightIssues(state.sourceText || '', state.stagedJsonText || '', config), state.sourceText || '').filter(isRigidWeightReviewEligibleIssue).map((issue) => {
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
      candidates: ranking.candidates.slice(0, 5),
      rejectedCandidates: ranking.rejectedCandidates.slice(0, 3),
    }, config);
  }).filter((issue) => !issue.mapped);
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

export function modeARigidCandidateMarkup(issue, rowIndex) {
  // Ranked catalog candidates and the Unknown physical-length sidecar are
  // evidence only. Never manufacture approved mass from a master match.
  const ranked = issue.massSuggestionOnly ? [] : (issue.candidates || []);
  const chips = ranked.map((candidate) => {
    const weight = candidate.suggestedWeight ?? candidate.selectedWeight ?? candidate.weight;
    const label = candidate.referenceFamily || candidate.typeDesc || candidate.valveType || 'Unknown reference';
    const method = candidate.preferred ? 'exact-length master' : (candidate.weightMethod || 'ranked master');
    const sourceApproved = isApprovedPhysicalMassCandidate(candidate, weight);
    if (!sourceApproved) {
      const evidence = [
        'ESTIMATE ONLY: no approved physical-component mass',
        'Family: ' + label,
        'Method: ' + method,
        'Rating: ' + (issue.rating || '-'),
        'Length delta: ' + (candidate.lengthDelta ?? 'n/a') + ' mm',
        candidate.weightWarning || '',
      ].filter(Boolean).join(' | ');
      return `<span data-mode-a-rigid-advisory="true"
        title="${attr(evidence)}"
        style="font-size:11px;padding:3px 6px;border:1px solid #6d5590;border-radius:4px;">≈ ${esc(weight)} kg · ${esc(label)} · ${esc(method)} · advisory only</span>`;
    }
    return `<button type="button" class="mc-rigid-review-candidate"
      data-mode-a-rigid-approved="true"
      data-mode-a-rigid-candidate="${rowIndex}" data-mode-a-rigid-weight="${attr(weight)}"
      title="Approved physical source mass" style="font-size:11px;padding:3px 6px;cursor:pointer;">${esc(weight)} kg · approved</button>`;
  }).join('');
  const unknown = issue.unknownComponentSuggestion;
  const unknownEvidence = unknown?.ok
    ? `<span data-mode-a-unknown-weight-suggestion="true" title="${attr([
        'Unknown physical-component length rule — ADVISORY ONLY',
        'Family: ' + unknown.referenceFamily,
        'Physical length: ' + unknown.componentLengthMm + ' mm',
        'Reference length: ' + unknown.referenceLengthMm + ' mm',
        'Reference weight: ' + unknown.referenceWeightKg + ' kg',
        'Threshold: ' + unknown.thresholdMm + ' mm',
        'Mass is NOT approved or automatically applied',
      ].join(' | '))}" style="font-size:11px;padding:3px 6px;border:1px dashed #6d5590;border-radius:4px;">Length-rule ≈ ${esc(unknown.suggestedKg)} kg · ${esc(unknown.referenceFamily)} · advisory only</span>`
    : unknown ? `<span data-mode-a-unknown-weight-hold="true" title="${attr(unknown.reason || unknown.code)}" style="font-size:11px;padding:3px 6px;border:1px dashed #6d5590;border-radius:4px;">Unknown length-rule HOLD · ${esc(unknown.code)}</span>`
      : '';
  return [chips, unknownEvidence].filter(Boolean).join(' ') ;
}

function rowMarkup(issue, rowIndex) {
  const best = issue.candidates?.[0] || null;
  const info = ratingInfo(issue);
  const badge = info.conflict
    ? '<span title="Rating conflict with DTXR" style="color:#fca5a5;font-weight:700;"> !</span>'
    : (info.missingWithDtxr ? '<span title="DTXR Rating available as evidence" style="color:#fbbf24;font-weight:700;"> DTXR</span>' : '');
  const search = [issue.fileName, issue.alias, issue.branchName, issue.nodeNumberDisplay, issue.nodeNumber, issue.dtxr].map((value) => text(value).toLowerCase()).join(' ');
  return `<tr data-mode-a-rigid-review-row data-source-id="${attr(issue.sourceId)}" data-search="${attr(search)}">
    <td style="padding:7px;border-bottom:1px solid rgba(148,163,184,.1);white-space:nowrap;">${esc(issue.fileName || issue.alias || issue.sourceId)}</td>
    <td title="${attr(issue.branchName)}" style="padding:7px;border-bottom:1px solid rgba(148,163,184,.1);min-width:260px;">${esc(issue.branchName)}</td>
    <td title="${attr([issue.sourceBoreAuthority || 'original XML', issue.sourceOutsideDiameterMm ? `Source OD ${issue.sourceOutsideDiameterMm} mm` : '', issue.boreAuthorityMismatch ? `Corrected projected DN ${issue.projectedBoreMm}` : ''].filter(Boolean).join(' | '))}" style="padding:7px;border-bottom:1px solid rgba(148,163,184,.1);">${esc(issue.boreMm == null ? '' : `${Number(issue.boreMm).toFixed(0)} mm`)}</td>
    <td style="padding:7px;border-bottom:1px solid rgba(148,163,184,.1);"><input type="text" class="mc-rigid-review-rating-input" data-review-id="${attr(issue.reviewId)}" data-source-id="${attr(issue.sourceId)}" data-issue-key="${attr(issue.key)}" value="${attr(info.shownRating)}" title="${attr(info.title)}" style="width:64px;background:#101827;color:#fff;border:1px solid ${info.conflict || info.missingWithDtxr ? '#ef4444' : '#31455f'};border-radius:4px;padding:4px;font-size:11px;">${badge}</td>
    <td style="padding:7px;border-bottom:1px solid rgba(148,163,184,.1);">${esc(issue.nodeNumberDisplay || issue.nodeNumber)}</td>
    <td title="${attr(issue.dtxrSourcePath || '')}" style="padding:7px;border-bottom:1px solid rgba(148,163,184,.1);min-width:180px;">${esc(issue.dtxr || 'Not found')}</td>
    <td style="padding:7px;border-bottom:1px solid rgba(148,163,184,.1);white-space:nowrap;">${esc(issue.lengthMm == null ? '' : `${Number(issue.lengthMm).toFixed(1)} mm`)}</td>
    <td style="padding:7px;border-bottom:1px solid rgba(148,163,184,.1);">
       <input type="number" min="0" step="0.001" class="mc-rigid-review-input" data-review-id="${attr(issue.reviewId)}" data-source-id="${attr(issue.sourceId)}" data-issue-key="${attr(issue.key)}" value="" placeholder="kg" style="width:92px;background:#101827;color:#fff;border:1px solid #31455f;border-radius:4px;padding:4px;">
       <label style="display:block;font-size:10px;color:#e9c875;white-space:nowrap;" title="Verify the physical-component mass independently before accepting an unapproved suggestion."><input type="checkbox" data-rigid-suggestion-verified> Reviewed</label>
    </td>
    <td style="padding:7px;border-bottom:1px solid rgba(148,163,184,.1);min-width:300px;">${modeARigidCandidateMarkup(issue, rowIndex) || '<span style="color:#64748b;">No suggestion</span>'}
      ${proposedRigidReviewWeight(issue) && !proposedRigidReviewWeight(issue).approved ? `<button type="button" data-mode-a-rigid-propose="${rowIndex}" style="margin-left:4px;cursor:pointer;border:1px solid #8c6f2e;background:#342609;color:#ffe7a3;border-radius:4px;">Use draft</button>` : ''}
      </td>
  </tr>`;
}

function popupMarkup(rows, entries) {
  const sourceOptions = entries.map((entry) => `<option value="${attr(entry.sourceId)}">${esc(entry.fileName)}</option>`).join('');
  return `<div class="mc-rigid-review-dialog" role="dialog" aria-modal="true" aria-label="Consolidated rigid zero weight review" style="color:#e2e8f0;max-height:90vh;overflow:auto;background:#0f172a;border:1px solid #253a55;border-radius:8px;padding:18px;max-width:1380px;width:96%;">
    <div style="display:flex;justify-content:space-between;gap:16px;align-items:center;border-bottom:1px solid #253a55;padding-bottom:12px;margin-bottom:12px;">
      <div><div style="font-size:18px;font-weight:700;color:#9cc5ff;">Rigid Weights Need Review — Consolidated</div><div data-mode-a-rigid-summary style="font-size:12px;color:#94a3b8;margin-top:4px;">${rows.length} rigid node(s) across ${entries.length} XML file(s).</div></div>
      <button type="button" data-mode-a-rigid-cancel style="cursor:pointer;background:transparent;border:1px solid #475569;border-radius:6px;color:#94a3b8;padding:6px 12px;">Cancel Batch Run</button>
    </div>
    <div style="background:#2a210b;border:1px solid #7c5a18;color:#ffe7a3;padding:9px;border-radius:6px;font-size:12px;margin-bottom:10px;">One review gate covers all enabled XML models. Source identity is preserved; Rating and Weight changes are written only to that XML. “Use All Exact Suggestions” fills only independently approved source masses. Empirical estimates are review drafts only. Apply All Suggestions prepopulates suggested kg for independent per-row review; unapproved values require Reviewed confirmation before committing. Enter mass in kg; the optional kg→N CII export conversion applies ×10 only at output.</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">
      <input type="search" data-mode-a-rigid-search placeholder="Search source / branch / node..." style="min-width:250px;padding:6px;background:#0b1220;color:#e2e8f0;border:1px solid #475569;border-radius:5px;">
      <select data-mode-a-rigid-source style="padding:6px;background:#0b1220;color:#e2e8f0;border:1px solid #475569;border-radius:5px;"><option value="">All XML files</option>${sourceOptions}</select>
      <button type="button" data-mode-a-rigid-refresh style="cursor:pointer;background:#1e293b;border:1px solid #334155;color:#cbd5e1;border-radius:6px;padding:7px 12px;">Refresh Suggestions</button>
      <button type="button" data-mode-a-rigid-apply-suggestions style="cursor:pointer;background:#43330f;color:#ffe7a3;border:1px solid #ad8129;border-radius:6px;padding:7px 12px;">Apply All Suggestions</button>
      <button type="button" data-mode-a-rigid-fill-exact style="cursor:pointer;background:#1e293b;border:1px solid #334155;color:#cbd5e1;border-radius:6px;padding:7px 12px;">Use All Exact Suggestions</button>
      <span data-mode-a-rigid-status style="font-size:12px;color:#94a3b8;"></span>
    </div>
    <div style="overflow:auto;max-height:55vh;border:1px solid rgba(148,163,184,.15);border-radius:6px;"><table style="border-collapse:collapse;font-size:12px;width:100%;text-align:left;"><thead><tr style="background:rgba(30,41,59,.55);color:#fff;position:sticky;top:0;z-index:1;"><th style="padding:7px;">Source XML</th><th style="padding:7px;">Branch</th><th style="padding:7px;">Bore</th><th style="padding:7px;">Rating</th><th style="padding:7px;">Node</th><th style="padding:7px;">DTXR</th><th style="padding:7px;">Length</th><th style="padding:7px;">Manual Weight (kg)</th><th style="padding:7px;">Nearest Suggestions</th></tr></thead><tbody data-mode-a-rigid-body>${rows.map(rowMarkup).join('')}</tbody></table></div>
    <div style="display:flex;justify-content:flex-end;margin-top:14px;border-top:1px solid #253a55;padding-top:14px;"><button type="button" data-mode-a-rigid-apply style="cursor:pointer;background:#1e4ed8;border:none;color:#fff;border-radius:6px;padding:9px 18px;font-weight:700;">Apply Weights and Run All Models</button></div>
  </div>`;
}

function collectCurrentValues(overlay) {
  const weights = new Map();
  const ratings = new Map();
  overlay.querySelectorAll('.mc-rigid-review-input').forEach((input) => {
    const numeric = Number(input.value);
    if (Number.isFinite(numeric) && numeric > 0 && input.dataset.rigidSuggestionDraft !== 'estimate')
      weights.set(input.dataset.reviewId || '', numeric);
  });
  overlay.querySelectorAll('.mc-rigid-review-rating-input').forEach((input) => {
    if (text(input.value)) ratings.set(input.dataset.reviewId || '', text(input.value));
  });
  return { weights, ratings };
}

function bindCandidateButtons(overlay, rows) {
  overlay.querySelectorAll('[data-mode-a-rigid-candidate]').forEach((button) => button.addEventListener('click', () => {
    const index=Number(button.dataset.modeARigidCandidate);
    const input=overlay.querySelectorAll('.mc-rigid-review-input')[index];
    const weight=Number(button.dataset.modeARigidWeight);
    if(input && button.dataset.modeARigidApproved==='true' &&
       Number.isFinite(weight) && weight>0)
      stageRigidReviewProposal(input,{weight,approved:true,reference:'Approved source mass selected'});
  }));
  overlay.querySelectorAll('[data-mode-a-rigid-propose]').forEach(button=>button.addEventListener('click',()=>{
    const index=Number(button.dataset.modeARigidPropose);
    const input=overlay.querySelectorAll('.mc-rigid-review-input')[index];
    if(input)stageRigidReviewProposal(input,proposedRigidReviewWeight(rows[index]));
  }));
}

export function openModeAConsolidatedRigidWeightReviewPopup(entries = []) {
  const workingEntries = entries.map((entry) => ({ ...entry, issues: [...(entry.issues || [])] }));
  let rows = flattenModeARigidReviewEntries(workingEntries);
  if (!rows.length) return Promise.resolve({ cancelled: false, updates: {} });
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'model-converters-workflow-popup-overlay mc-rigid-review-overlay';
    overlay.innerHTML = popupMarkup(rows, workingEntries);
    document.body.appendChild(overlay);
    const body = overlay.querySelector('[data-mode-a-rigid-body]');
    const status = overlay.querySelector('[data-mode-a-rigid-status]');
    const summary = overlay.querySelector('[data-mode-a-rigid-summary]');
    const search = overlay.querySelector('[data-mode-a-rigid-search]');
    const source = overlay.querySelector('[data-mode-a-rigid-source]');
    const initialRatings = new Map([...overlay.querySelectorAll('.mc-rigid-review-rating-input')]
      .map(input=>[input.dataset.reviewId||'',text(input.value)]));
    const setStatus = (message, bad = false) => { if (status) { status.textContent = message; status.style.color = bad ? '#ef4444' : '#10b981'; } };
    const filter = () => {
      const q = text(search?.value).toLowerCase();
      const sourceId = source?.value || '';
      overlay.querySelectorAll('[data-mode-a-rigid-review-row]').forEach((tr) => {
        const show = (!sourceId || tr.dataset.sourceId === sourceId) && (!q || (tr.dataset.search || '').includes(q));
        tr.style.display = show ? '' : 'none';
      });
    };
    const draw = (preserve = new Map()) => {
      rows = flattenModeARigidReviewEntries(workingEntries);
      if (body) body.innerHTML = rows.map(rowMarkup).join('');
      overlay.querySelectorAll('.mc-rigid-review-input').forEach((input) => { if (preserve.has(input.dataset.reviewId || '')) input.value = preserve.get(input.dataset.reviewId || ''); });
      if (summary) summary.textContent = `${rows.length} rigid node(s) across ${new Set(rows.map((row) => row.sourceId)).size} XML file(s).`;
      bindCandidateButtons(overlay, rows);
      filter();
    };
    bindCandidateButtons(overlay, rows);
    overlay.addEventListener('input', event=>{
      if(event.target?.matches?.('.mc-rigid-review-input')) clearRigidReviewProposal(event.target);
    });
    overlay.querySelector('[data-mode-a-rigid-apply-suggestions]')?.addEventListener('click',()=>{
      let filled=0,skipped=0;
      rows.forEach((row,index)=>{
        const input=overlay.querySelectorAll('.mc-rigid-review-input')[index];
        const proposal=proposedRigidReviewWeight(row);
        if(!input || !proposal || (input.value && !input.dataset.rigidSuggestionDraft)) {skipped++;return;}
        if(stageRigidReviewProposal(input,proposal))filled++; else skipped++;
      });
      setStatus(`Prefilled ${filled} review draft(s); ${skipped} unavailable or entered manually. Verify each estimated mass before Apply.`,filled===0);
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
        if (input && stageRigidReviewProposal(input,proposedRigidReviewWeight(row))) count += 1;
      });
      setStatus(`Filled ${count} preferred exact suggestion(s). Review remaining rows manually.`, false);
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
        entry.issues = await collectModeARigidWeightReviewIssues(entry.state, config);
      }
      draw(current.weights);
      setStatus(`Suggestions refreshed for ${workingEntries.length} XML file(s).`, false);
      if (button) button.disabled = false;
    });

    overlay.querySelector('[data-mode-a-rigid-cancel]')?.addEventListener('click', () => {
      overlay.remove();
      resolve({ cancelled: true, updates: {} });
    });

    overlay.querySelector('[data-mode-a-rigid-apply]')?.addEventListener('click', () => {
      const updates = {};
      const missing = [], unreviewed = [];
      overlay.querySelectorAll('.mc-rigid-review-input').forEach((input) => {
        const sourceId = input.dataset.sourceId || '';
        const key = input.dataset.issueKey || '';
        const numeric = Number(input.value);
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
      });
      overlay.querySelectorAll('.mc-rigid-review-rating-input').forEach((input) => {
        const sourceId = input.dataset.sourceId || '';
        const key = input.dataset.issueKey || '';
        if (!text(input.value) || text(input.value) === initialRatings.get(input.dataset.reviewId || '')) return;
        updates[sourceId] ||= { ratingsByKey: {}, weightsByKey: {} };
        updates[sourceId].ratingsByKey[key] = text(input.value);
      });
      if(missing.length || unreviewed.length){
        setStatus(`Enter a positive weight for ${missing.length} missing row(s). Independently review ${unreviewed.length} estimate draft(s) before Apply. No updates applied.`,true);
        return;
      }
      overlay.remove();
      resolve({ cancelled: false, updates });
    });
  });
}
