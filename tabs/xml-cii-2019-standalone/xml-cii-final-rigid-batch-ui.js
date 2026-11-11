/**
 * Explicit two-gate UI for threshold-based FINAL CII weight corrections.
 * Preview is read-only. Per-row selection is mandatory, and provisional
 * catalog suggestions additionally require a review-only opt-in + approval.
 */
import {
  planFinalRigidBatchCorrections, planAllNearestBatchDraftSelection,
} from './xml-cii-final-rigid-batch-corrections.js?v=20261109-ef05-dtxr-phase6-r5';
import { summarizeFinalRigidBatch } from './xml-cii-final-rigid-review-evidence.js';

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const pretty = (v) => v === null || v === undefined || String(v).trim() === ''
  ? '—' : Number.isFinite(Number(v))
    ? Number(v).toFixed(3).replace(/\.?0+$/, '') : '—';
const candidateTitle = (entry) => {
  if (!entry) return 'No qualified suggestion';
  return pretty(entry.masterWeightKg) + ' kg · ' +
    (entry.matchPct === null || entry.matchPct === undefined ? 'Unscored' : entry.matchPct + '%') +
    ' · ' + (entry.title || entry.method || 'Master row');
};

export function installFinalRigidBatchControls({
  overlay, inventory, plans, getEditedValues, getCurrentResult,
  stageAndVerify, verifyUnchanged, isReady,
}) {
  const tableScroller = overlay.querySelector('table')?.parentElement;
  if (!tableScroller) return;
  const toolbar = document.createElement('section');
  toolbar.setAttribute('data-final-rigid-batch-toolbar', '');
  toolbar.style.cssText = 'border:1px solid #334155;border-radius:7px;margin:8px 0;padding:9px;background:#111e32;color:#dbeafe;';
  toolbar.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;">' +
    '<strong>Batch Weight Correction</strong>' +
    '<label>Absolute error threshold ± <input type="number" data-final-rigid-batch-threshold min="0" max="100000" step="1" value="40" style="width:66px;padding:5px;background:#0b1220;border:1px solid #475569;color:#fff;border-radius:4px;"> %</label>' +
    '<label>Scope <select data-final-rigid-batch-scope style="padding:5px;background:#0b1220;border:1px solid #475569;color:#fff;border-radius:4px;">' +
    '<option value="all">All RIGIDs</option><option value="filtered">Filtered rows</option><option value="selected">Selected rows</option></select></label>' +
    '<label title="Unverified source owner or approximate catalog estimates require manual approval">' +
    '<input type="checkbox" data-final-rigid-batch-review-only> Include approximate / unverified nearest</label>' +
    '<button type="button" data-final-rigid-batch-preview style="cursor:pointer;padding:7px 11px;border:1px solid #3b82f6;background:#1d4ed8;color:#fff;border-radius:5px;">Preview Batch Corrections</button>' +
    '<button type="button" data-final-rigid-batch-summary-download disabled style="padding:7px;border:1px solid #64748b;background:#1e293b;color:#fff;border-radius:5px;">Download Review Summary JSON</button>' +
    '</div><div data-final-rigid-batch-status role="status" style="font-size:11px;color:#94a3b8;margin-top:5px;">' +
    'Preview → choose exact RIGID pointers → verify transaction → re-extract revised CII. No automatic mass approval.</div>';
  tableScroller.insertAdjacentElement('beforebegin', toolbar);

  const thresholdInput = toolbar.querySelector('[data-final-rigid-batch-threshold]');
  const scopeInput = toolbar.querySelector('[data-final-rigid-batch-scope]');
  const includeInput = toolbar.querySelector('[data-final-rigid-batch-review-only]');
  const status = toolbar.querySelector('[data-final-rigid-batch-status]');
  const preview = toolbar.querySelector('[data-final-rigid-batch-preview]');
  const summaryDownload = toolbar.querySelector('[data-final-rigid-batch-summary-download]');
  let lastReconciliation = null, lastEditedSnapshot = null;
  const editFingerprint = () => JSON.stringify([...getEditedValues()]);
  summaryDownload.addEventListener('click', () => {
    if (!lastReconciliation) return;
    const result = getCurrentResult();
    if (!result || !isReady() || lastEditedSnapshot !== editFingerprint()) {
      status.textContent = 'REFUSED: CII or edited values changed; re-verify the batch review.';
      return;
    }
    const json = JSON.stringify(lastReconciliation, null, 2) + '\n';
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = String(result.ciiName || 'final-rigid')
      .replace(/\.cii$/i, '') + '_BATCH_REVIEW_SUMMARY.json';
    document.body.appendChild(link);
    link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  });
  let dialogLayer = null;

  const snapshot = () => ({
    thresholdPct: thresholdInput.value,
    scope: scopeInput.value,
    includeReviewOnly: includeInput.checked,
    visiblePointers: [...overlay.querySelectorAll('[data-final-rigid-row]')].filter((r) => !r.hidden).map((r) => Number(r.dataset.pointer)),
    selectedPointers: [...overlay.querySelectorAll('[data-final-rigid-row]')].filter((r) =>
      r.querySelector('[data-final-rigid-select]')?.checked).map((r) => Number(r.dataset.pointer)),
    currentEditedValues: getEditedValues(),
    weightScale: getCurrentResult()?.finalRigidReviewEvidence?.weightScale,
    selectedIndices: new Map([...overlay.querySelectorAll('[data-final-rigid-suggestion]')].filter((select) =>
      select.value !== '').map((select) =>
      [Number(select.getAttribute('data-final-rigid-suggestion')), Number(select.value)])),
  });
  const close = () => { dialogLayer?.remove(); dialogLayer = null; };
  overlay.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && dialogLayer) { ev.stopImmediatePropagation(); ev.preventDefault(); close(); }
  }, true);
  preview.addEventListener('click', () => {
    close();
    lastReconciliation = null; lastEditedSnapshot = null;
    summaryDownload.disabled = true;
    if (!isReady() || !getCurrentResult()) {
      status.textContent = 'REFUSED: Weight editor is not ready or conversion run changed.';
      return;
    }
    const base = snapshot();
    let plan;
    try { plan = planFinalRigidBatchCorrections(inventory, plans, base); }
    catch (error) { status.textContent = 'REFUSED: ' + error.message; return; }

    // A fresh review must never inherit stale decisions from a prior preview.
    const selections = new Set();
    const candidateIndices = new Map(base.selectedIndices);
    const ownerSelections = new Map();
    const manualReferences = new Map();
    const recalc = () => planFinalRigidBatchCorrections(inventory, plans, {
      ...base, includeReviewOnly: base.includeReviewOnly, selectedIndices: candidateIndices,
      ownerSelections, manualReferences,
    });
    const retainSummary = (plan, selectedPointers, verification) => {
      lastReconciliation = {
        schema: 'xml-cii2019-final-rigid-batch-review/v1',
        converterInputDigest: getCurrentResult()?.finalRigidReviewEvidence?.engineInputDigest || '',
        ciiName: getCurrentResult()?.ciiName || '',
        ...summarizeFinalRigidBatch(plan, selectedPointers),
        verification,
        releaseStatus: 'NOT_ENGINEERING_APPROVED_BY_BATCH_REVIEW',
      };
      lastEditedSnapshot = editFingerprint();
      summaryDownload.disabled = false;
      const x = lastReconciliation;
      status.textContent = 'Batch review: ' + x.corrected + ' corrected · ' +
        x.unchanged + ' unchanged · ' + x.skipped + ' skipped · ' +
        x.unresolved + ' unresolved · ' + x.warningRows +
        ' warnings. Download Review Summary JSON for per-pointer reasons.';
    };
    dialogLayer = document.createElement('div');
    dialogLayer.setAttribute('data-final-rigid-batch-dialog', '');
    dialogLayer.setAttribute('role', 'dialog');
    dialogLayer.setAttribute('aria-modal', 'true');
    dialogLayer.setAttribute('aria-label', 'Review batch weight corrections');
    dialogLayer.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#030712df;display:flex;align-items:center;justify-content:center;padding:18px;';
    dialogLayer.innerHTML = '<div style="background:#0f172a;color:#e2e8f0;border:1px solid #64748b;border-radius:8px;' +
      'padding:15px;max-width:1200px;width:97%;max-height:88vh;display:flex;flex-direction:column;gap:10px;">' +
      '<h3 style="margin:0;">Preview Batch Weight Corrections</h3>' +
      '<p style="margin:0;font-size:12px;color:#fbbf24;">Selected eligible corrections can be staged even when other pointers are skipped or need metadata review. Skipped rows remain unchanged and do not block. Catalog suggestions are advisory, not approved physical masses; explicit review and transaction verification remain required.</p>' +
      '<div data-final-rigid-batch-summary role="status" style="font-size:12px;color:#dbeafe;"></div>' +
      '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px;font-size:12px;">' +
      '<label title="Unlock separately reviewed approximate/unverified suggestions and source metadata warnings; structural holds and below-threshold rows remain excluded">' +
      '<input type="checkbox" data-final-rigid-batch-include-review> Include approximate / unverified nearest</label>' +
      '<button type="button" data-final-rigid-batch-apply-nearest title="Select the nearest candidate for each eligible RIGID in scope, including review-only drafts. Does not approve, stage or change any CII weights." style="cursor:pointer;background:#744c13;color:#fff;' +
      'padding:6px 10px;border-radius:5px;border:1px solid #eab308;">Apply All Nearest Suggestions</button>' +
      '<button type="button" data-final-rigid-batch-approve-all disabled style="cursor:pointer;background:#1d4ed8;color:#fff;' +
      'padding:6px 10px;border-radius:5px;border:1px solid #60a5fa;">✓ Approve All Eligible (0)</button>' +
      '<button type="button" data-final-rigid-batch-clear-all disabled style="cursor:pointer;background:#1e293b;color:#e2e8f0;' +
      'padding:6px 10px;border-radius:5px;border:1px solid #475569;">Clear Selection</button>' +
      '</div><div data-final-rigid-batch-nearest-note role="status" style="font-size:11px;color:#fbd38d;display:none;"></div>' +
      '<label style="font-size:12px;"><input type="checkbox" data-final-rigid-batch-show-held> Show all skipped, advisory-warning and no-change rows</label>' +
       '<span style="font-size:11px;color:#a7c7ee;">Short (≤25 mm) final RIGIDs remain visible for documented manual edits, even without a qualified source owner.</span>' +
      '<div style="overflow:auto;flex:1;border:1px solid #334155;border-radius:5px;">' +
      '<table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left;">' +
      '<thead><tr style="position:sticky;top:0;background:#1e293b;">' +
      ['<label title="Select/deselect all currently eligible RIGIDs in the selected scope">' +
        '<input type="checkbox" data-final-rigid-batch-approve-all-checkbox disabled ' +
        'aria-label="Approve all eligible RIGID pointers"> All eligible</label>',
        'RIGID', 'Element / FROM → TO', 'Element Length (mm)', 'Original CII units', 'Nearest suggestion (kg / score)',
        'Proposed CII units', 'Error %', 'Source owner review', 'Manual reference (CII units)', 'Decision / evidence'].map((s) =>
        '<th style="padding:8px;white-space:nowrap;">' + s + '</th>').join('') +
      '</tr></thead><tbody data-final-rigid-batch-rows></tbody></table></div>' +
      '<label style="color:#fbbf24;font-size:12px;"><input type="checkbox" data-final-rigid-batch-confirm-review>' +
      ' I reviewed the selected approximate / unverified proposals and accept them as explicit REVIEW-ONLY weight corrections (not source mass approval).</label>' +
      '<div data-final-rigid-batch-stage-reason role="status" style="font-size:11px;color:#fbbf24;"></div>' +
      '<div data-final-rigid-batch-attestation-panel hidden style="padding:10px;border-radius:6px;border:1px solid #fbbf24;background:#2a210b;color:#ffe3a0;font-size:12px;">' +
      '<strong>Explicit review confirmation before staging</strong>' +
      '<p data-final-rigid-batch-attestation-description style="margin:6px 0;">No CII edits have been made.</p>' +
      '<p style="margin:5px 0;">I confirm that I reviewed the selected pointer corrections. ' +
      'Catalog matches do NOT prove physical-component masses or resolve source ownership. ' +
      'Unresolved corrections remain REVIEW-ONLY after re-extraction.</p>' +
      '<button type="button" data-final-rigid-batch-attestation-accept style="cursor:pointer;border:1px solid #60a5fa;border-radius:5px;background:#1d4ed8;color:white;padding:7px 10px;">I reviewed these corrections — Stage &amp; Verify</button>' +
      ' <button type="button" data-final-rigid-batch-attestation-cancel style="cursor:pointer;border:1px solid #64748b;border-radius:5px;background:#1e293b;color:white;padding:7px 10px;">Back to corrections</button>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:9px;">' +
      '<button type="button" data-final-rigid-batch-continue style="padding:8px;border:1px solid #475569;border-radius:5px;background:#1e293b;color:#fff;cursor:pointer;">Continue without weight changes</button>' +
      '<button type="button" data-final-rigid-batch-cancel style="padding:8px;border:1px solid #475569;border-radius:5px;background:#1e293b;color:#fff;cursor:pointer;">Cancel</button>' +
      '<button type="button" data-final-rigid-batch-stage disabled style="padding:8px 12px;border:none;border-radius:5px;background:#1d4ed8;color:#fff;cursor:pointer;">Stage & Verify Selected Corrections</button>' +
      '</div></div>';
    overlay.append(dialogLayer);
    const summary = dialogLayer.querySelector('[data-final-rigid-batch-summary]');
    const body = dialogLayer.querySelector('[data-final-rigid-batch-rows]');
    const showHeld = dialogLayer.querySelector('[data-final-rigid-batch-show-held]');
    const includeReview = dialogLayer.querySelector('[data-final-rigid-batch-include-review]');
    const approveAll = dialogLayer.querySelector('[data-final-rigid-batch-approve-all]');
    const applyAllNearest = dialogLayer.querySelector('[data-final-rigid-batch-apply-nearest]');
    const nearestNote = dialogLayer.querySelector('[data-final-rigid-batch-nearest-note]');
    const clearAll = dialogLayer.querySelector('[data-final-rigid-batch-clear-all]');
    const approveAllCheckbox = dialogLayer.querySelector('[data-final-rigid-batch-approve-all-checkbox]');
    const confirm = dialogLayer.querySelector('[data-final-rigid-batch-confirm-review]');
    const stage = dialogLayer.querySelector('[data-final-rigid-batch-stage]');
    const continueButton = dialogLayer.querySelector('[data-final-rigid-batch-continue]');
    const stageReason = dialogLayer.querySelector('[data-final-rigid-batch-stage-reason]');
    const attestationPanel = dialogLayer.querySelector('[data-final-rigid-batch-attestation-panel]');
    const attestationDescription = dialogLayer.querySelector('[data-final-rigid-batch-attestation-description]');
    const attestationAccept = dialogLayer.querySelector('[data-final-rigid-batch-attestation-accept]');
    const attestationCancel = dialogLayer.querySelector('[data-final-rigid-batch-attestation-cancel]');
    includeReview.checked = base.includeReviewOnly;
    const candidateFor = (row) => plans[row.pointer - 1]?.nearestSuggestions || [];
    const ownerOptionsFor = (pointer) => plans[pointer - 1]?.sourceContext?.ownerCandidates || [];

    function updateStage() {
      const current = recalc();
      const eligibleIds = new Set(current.eligible.map((r) => r.pointer));
      // Never retain a prior bulk selection if its candidate/eligibility changed.
      for (const pointer of selections) if (!eligibleIds.has(pointer)) selections.delete(pointer);
      const chosen = current.eligible.filter((r) => selections.has(r.pointer));
      const needsApproval = chosen.some((r) => r.reviewRequired);
      const disableReason = !isReady() || !getCurrentResult()
        ? 'Conversion state is stale or the editor has invalid values; reopen the current review.'
        : current.eligible.length === 0
          ? 'No eligible numerical corrections. Review warnings, then continue without changes.'
          : !chosen.length ? 'Select an eligible correction before staging.' : '';
      const awaitingAttestation = needsApproval && !confirm.checked;
      // The stage button is actionable when proposals exist. If the separate
      // review acknowledgement is missing, its first click opens the
      // confirmation panel; it never stages without an explicit second act.
      stage.disabled = Boolean(disableReason);
      const skippedCount = current.skipped?.length || 0;
      stage.textContent = chosen.length
        ? 'Stage & Verify ' + chosen.length + ' Selected Corrections'
        : 'Stage & Verify Selected Corrections';
      stage.title = disableReason || (awaitingAttestation
        ? 'Click to review and explicitly acknowledge the ' + chosen.length + ' selected draft corrections.'
        : 'Only ' + chosen.length + ' selected pointers will change. ' +
          skippedCount + ' skipped pointers do not block.');
      stageReason.textContent = disableReason || (awaitingAttestation
        ? 'NEXT: Click Stage & Verify to review and explicitly confirm ' + chosen.length +
          ' selected draft corrections; skipped pointers do not block.'
        : 'READY: ' + chosen.length + ' selected correction(s). ' +
          skippedCount + ' skipped pointers stay unchanged. ' +
          'Next: Apply Changes & Re-extract REVIEW-ONLY CII in the parent editor.');
      continueButton.textContent = chosen.length
        ? 'Discard ' + chosen.length + ' selections & continue unchanged'
        : 'Verify & continue unchanged';
      approveAll.disabled = current.eligible.length === 0;
      approveAll.textContent = '✓ Approve All Eligible (' + current.eligible.length + ')';
      approveAllCheckbox.disabled = current.eligible.length === 0;
      approveAllCheckbox.checked = current.eligible.length > 0 &&
        chosen.length === current.eligible.length;
      approveAllCheckbox.indeterminate = chosen.length > 0 &&
        chosen.length < current.eligible.length;
      clearAll.disabled = chosen.length === 0;
      const reviewOnlyCount = current.proposals.filter((r) => r.status === 'REVIEW_ONLY').length;
      const hardHoldCount = current.proposals.filter((r) =>
        r.status === 'SKIPPED_WITH_WARNING' || r.status === 'ALREADY_EDITED').length;
      const warnings = current.proposals.filter((r) =>
        r.warnings?.length && r.status !== 'OUT_OF_SCOPE').length;
      summary.textContent = chosen.length + ' selected of ' + current.eligible.length +
        ' eligible · ' + hardHoldCount + ' skipped (NOT blocking) · ' +
        current.belowThreshold.length + ' unchanged / below threshold · ' +
        warnings + ' advisory source warnings · ' +
        reviewOnlyCount + ' pending review opt-in · ' +
        (needsApproval && !confirm.checked ? 'acknowledgement required' :
          'no exported weights changed');
    }

    function render() {
      const current = recalc();
      if (attestationPanel) attestationPanel.hidden = true;
      body.innerHTML = current.proposals
        .filter((row) => row.status !== 'OUT_OF_SCOPE' &&
          (showHeld.checked || row.status === 'ELIGIBLE' ||
            row.status === 'REVIEW_ONLY' ||
            (inventory.rows[row.pointer - 1]?.linkedElements || []).some(
              e => Number.isFinite(Number(e.lengthMm)) &&
                Number(e.lengthMm) > 0 && Number(e.lengthMm) <= 25)))
        .map((row) => {
          const item = inventory.rows[row.pointer - 1];
          const linked = item?.linkedElements || [];
          // Final CII ELEMENTS geometry, not source physical-component length.
          // Preserve every linked element when a pointer is shared (hard-held).
          const elementTrace = linked.map((element) =>
            '#' + element.index + ' · ' + element.fromNode + ' → ' + element.toNode).join('; ') || 'Unreferenced';
          const elementLengths = linked.map((element) =>
            Number.isFinite(Number(element.lengthMm)) && Number(element.lengthMm) >= 0
              ? Number(Number(element.lengthMm).toFixed(3)).toString() : '—').join(', ') || '—';
          const available = candidateFor(row);
          const options = available.map((candidate, i) =>
            '<option value="' + i + '"' + (row.candidateIndex === i ? ' selected' : '') + '>' +
            esc(candidateTitle(candidate)) + (candidate.approximate ? ' · approximate' : '') +
            '</option>').join('');
          const approved = row.status === 'ELIGIBLE';
          if (!approved) selections.delete(row.pointer);
          const cell = (s) => '<td style="padding:7px;border-bottom:1px solid #26364b;vertical-align:top;">' + s + '</td>';
          const checked = approved && selections.has(row.pointer);
          const badge = (row.warnings?.length || row.status === 'SKIPPED_WITH_WARNING'
            ? 'WARNING · ' : '') + (row.reviewRequired ? 'REVIEW · ' : '');
          const sourceChoices = ownerOptionsFor(row.pointer);
          const chosenOwner = ownerSelections.get(row.pointer);
          const ownerChoices = sourceChoices.map((item, i) =>
            '<option value="' + i + '"' +
              (chosenOwner?.candidateIndex === i ? ' selected' : '') + '>' +
              esc(item.componentRefNo + ' · ' + item.side + ' node ' +
                item.sourceNode + ' · ' + item.componentType) + '</option>').join('');
          const ownerControl = sourceChoices.length
            ? '<select data-final-rigid-batch-owner="' + row.pointer +
                '" style="max-width:240px;"><option value="">Not selected</option>' +
                ownerChoices + '</select>' +
                '<input data-final-rigid-batch-owner-basis="' + row.pointer +
                '" type="text" placeholder="Drawing / ownership rationale (12+ chars)" ' +
                'value="' + esc(chosenOwner?.rationale || '') + '" style="max-width:240px;display:block;">'
            : '<span>Exact source-edge owner candidates unavailable</span>';
          const manualData = manualReferences.get(row.pointer) || {};
          const manualControl = '<label style="display:block;font-size:10px;">Final RIGID target' +
            '<input type="number" min="0" step="any" ' +
            'data-final-rigid-batch-manual-weight="' + row.pointer +
            '" placeholder="e.g. 2.984" value="' +
            esc(manualData.referenceWeight ?? '') + '" style="width:150px;display:block;"></label>' +
            '<select data-final-rigid-batch-manual-unit="' + row.pointer +
            '" style="width:175px;display:block;">' +
            '<option value="CII_OUTPUT_WEIGHT"' +
            (manualData.unit === 'SOURCE_KG' ? '' : ' selected') +
            '>As exported (CII units)</option>' +
            '<option value="SOURCE_KG"' +
            (manualData.unit === 'SOURCE_KG' ? ' selected' : '') +
            '>Source kg × run scale</option></select>' +
            '<small>kg conversion requires the captured ×1/×10 output scale.</small>' +
            '<input type="text" data-final-rigid-batch-manual-document="' + row.pointer +
            '" placeholder="Reference document ID" value="' +
            esc(manualData.documentRef || '') + '" style="max-width:170px;display:block;">' +
            '<input type="text" data-final-rigid-batch-manual-basis="' + row.pointer +
            '" placeholder="Pointer-local allocation basis" value="' +
            esc(manualData.basis || '') + '" style="max-width:220px;display:block;">';
          return '<tr data-final-rigid-batch-row="' + row.pointer + '">' +
            cell('<input type="checkbox" data-final-rigid-batch-approve="' + row.pointer + '"' +
              (checked ? ' checked' : '') + (approved ? '' : ' disabled') +
              ' aria-label="Approve RIGID pointer ' + row.pointer + '">') +
            cell(String(row.pointer)) +
            cell(esc(elementTrace)) +
            '<td data-final-rigid-batch-element-length="' + row.pointer +
              '" title="Emitted CII ELEMENT length from final DX/DY/DZ geometry; NOT necessarily physical component length" style="padding:7px;border-bottom:1px solid #26364b;vertical-align:top;white-space:nowrap;">' +
              esc(elementLengths) + '</td>' +
            cell(esc(pretty(row.originalWeight))) +
            cell(available.length ? '<select data-final-rigid-batch-candidate="' + row.pointer +
              '" style="max-width:260px;background:#0b1220;border:1px solid #475569;color:#fff;border-radius:4px;padding:4px;">' +
              options + '</select>' : '—') +
            cell(esc(pretty(row.proposedWeight))) +
            cell(row.errorPct === null ? '—' : esc((row.errorPct >= 0 ? '+' : '') + row.errorPct.toFixed(1) + '%')) +
            cell(sourceChoices.length ?
              '<details><summary style="cursor:pointer;">' +
              sourceChoices.length + ' source owner candidate(s)</summary>' +
              ownerControl + '</details>' :
              '<span title="No exact-edge candidate proved by source XML">Not verified</span>') +
            cell('<details ' +
              (linked.some(e => Number(e.lengthMm) > 0 && Number(e.lengthMm) <= 25)
                ? 'open ' : '') +
              '><summary style="cursor:pointer;">Manual final-pointer correction…</summary>' +
              manualControl + '</details>') +
            cell('<span style="color:' + (approved ? '#86efac' : '#fbbf24') + ';">' +
              esc(badge + (row.disposition || row.status)) +
              (row.skipCode ? ' · ' + esc(row.skipCode) : '') + '</span><div title="' +
              esc(row.candidate?.basis || row.reason) +
              '" style="max-width:240px;white-space:normal;font-size:10px;">' +
              esc(row.reason.split(' Source warnings:')[0]) +
              (row.warnings?.length ? '<details style="margin-top:4px;">' +
                '<summary style="cursor:pointer;color:#fbbf24;">' +
                row.warnings.length + ' advisory warning(s) — details</summary>' +
                '<div>' + esc(row.warnings.join('; ')) + '</div></details>' : '') +
              (row.candidate ? '<div>' +
                esc(row.candidate.method + ' · ' + (row.candidate.source || 'unidentified master row')) +
                '</div>' : '') + '</div>') + '</tr>';
        }).join('') || '<tr><td colspan="11" style="padding:14px;">No RIGIDs in the selected scope.</td></tr>';
      updateStage();
    }
    const selectAllEligible = (checked) => {
      const current = recalc();
      selections.clear();
      if (checked) for (const proposal of current.eligible) selections.add(proposal.pointer);
      // Select-all is only an explicit choice of rows, not a mass approval.
      // A provisional mass still needs the separate review acknowledgement.
      render();
    };
    includeReview.addEventListener('change', () => {
      base.includeReviewOnly = includeReview.checked;
      includeInput.checked = includeReview.checked;
      selections.clear();
      confirm.checked = false;
      render();
    });
    applyAllNearest.addEventListener('click', () => {
      if (!isReady() || !getCurrentResult()) {
        nearestNote.style.display = 'block';
        nearestNote.textContent = 'REFUSED: Conversion run changed; reopen the current CII review.';
        return;
      }
      // Every click resets all candidates IN SCOPE to nearest index 0.
      // This deliberately enables provisional draft inclusion, but does
      // NOT check the independent review acknowledgement or stage an edit.
      const planned = planAllNearestBatchDraftSelection(inventory, plans, {
        ...base,
        selectedIndices: candidateIndices, ownerSelections, manualReferences,
      });
      candidateIndices.clear();
      for (const [pointer, index] of planned.candidateIndices) candidateIndices.set(pointer, index);
      base.includeReviewOnly = true;
      includeReview.checked = true;
      includeInput.checked = true;
      selections.clear();
      for (const pointer of planned.selectedPointers) selections.add(pointer);
      confirm.checked = false;
      nearestNote.style.display = 'block';
      nearestNote.textContent = 'Nearest review drafts selected for ' +
        planned.selectedPointers.length + ' eligible pointers (' + planned.reviewRequired +
        ' require independent review); ' + planned.hardHeld + ' hard-held / already edited and ' +
        planned.belowThreshold + ' unchanged / below ±' + planned.plan.thresholdPct +
        '% not selected. Skipped rows do NOT block eligible selected corrections. ' +
        'Acknowledge the reviewed proposals and Stage & Verify; then apply changes in the parent editor. ' +
        'No source mass or CII bytes have changed.';
      render();
    });
    approveAll.addEventListener('click', () => selectAllEligible(true));
    clearAll.addEventListener('click', () => selectAllEligible(false));
    approveAllCheckbox.addEventListener('change', () =>
      selectAllEligible(approveAllCheckbox.checked));
    showHeld.addEventListener('change', render);
    dialogLayer.querySelector('[data-final-rigid-batch-cancel]').addEventListener('click', close);
    dialogLayer.querySelector('[data-final-rigid-batch-continue]').addEventListener('click', async () => {
      if (!isReady() || !getCurrentResult()) {
        stageReason.textContent = 'REFUSED: Stale conversion or invalid editor state.';
        return;
      }
      if (typeof verifyUnchanged !== 'function') {
        stageReason.textContent = 'REFUSED: No-change byte parity verifier unavailable.';
        return;
      }
      try {
        const verification = await verifyUnchanged();
        retainSummary(recalc(), [], { mode: 'VERIFIED_UNCHANGED',
          sourceSha256: verification?.audit?.originalSha256 || '',
          revisedSha256: verification?.audit?.revisedSha256 || '',
          unchangedBytesEqual: verification?.audit?.untouchedBytesEqual === true,
          changeCount: verification?.audit?.changes?.length ?? -1 });
        close();
      } catch (error) {
        stageReason.textContent = 'REFUSED: ' + (error?.message || error);
      }
    });
    confirm.addEventListener('change', () => {
      attestationPanel.hidden = true;
      updateStage();
    });
    body.addEventListener('change', (event) => {
      const target = event.target;
      if (target.matches('[data-final-rigid-batch-approve]')) {
        const pointer = Number(target.getAttribute('data-final-rigid-batch-approve'));
        if (target.checked) selections.add(pointer); else selections.delete(pointer);
        updateStage();
      } else if (target.matches('[data-final-rigid-batch-owner], [data-final-rigid-batch-owner-basis], [data-final-rigid-batch-manual-weight], [data-final-rigid-batch-manual-document], [data-final-rigid-batch-manual-basis], [data-final-rigid-batch-manual-unit]')) {
        const tr = target.closest('[data-final-rigid-batch-row]');
        const pointer = Number(tr?.getAttribute('data-final-rigid-batch-row'));
        const chosen = tr?.querySelector('[data-final-rigid-batch-owner]');
        const rationale = tr?.querySelector('[data-final-rigid-batch-owner-basis]')?.value || '';
        if (chosen && chosen.value !== '') {
          ownerSelections.set(pointer, { candidateIndex: Number(chosen.value), rationale });
        } else ownerSelections.delete(pointer);
        const manualWeight = tr?.querySelector('[data-final-rigid-batch-manual-weight]')?.value || '';
        const manualDoc = tr?.querySelector('[data-final-rigid-batch-manual-document]')?.value || '';
        const manualBasis = tr?.querySelector('[data-final-rigid-batch-manual-basis]')?.value || '';
        const manualUnit = tr?.querySelector('[data-final-rigid-batch-manual-unit]')?.value || 'CII_OUTPUT_WEIGHT';
        if (manualWeight.trim() || manualDoc.trim() || manualBasis.trim()) {
          manualReferences.set(pointer, { referenceWeight: manualWeight,
            documentRef: manualDoc, basis: manualBasis, unit: manualUnit });
          // Manual pointer edits must remain review-only, never inherit source
          // approval from a catalog suggestion.
          base.includeReviewOnly = true;
          includeReview.checked = true;
          includeInput.checked = true;
        } else manualReferences.delete(pointer);
        selections.delete(pointer);
        confirm.checked = false;
        render();
      } else if (target.matches('[data-final-rigid-batch-candidate]')) {
        const pointer = Number(target.getAttribute('data-final-rigid-batch-candidate'));
        candidateIndices.set(pointer, Number(target.value));
        selections.delete(pointer);
        confirm.checked = false;
        render();
      }
    });
    const stageSelected = async () => {
      updateStage();
      if (stage.disabled || !isReady()) return;
      const current = recalc();
      const chosen = current.eligible.filter((r) => selections.has(r.pointer));
      if (!chosen.length) return;
      if (chosen.some((r) => r.reviewRequired) && !confirm.checked) {
        const warningCount = chosen.filter(r => r.warnings?.length).length;
        attestationDescription.textContent = chosen.length + ' selected final RIGIDs (' +
          warningCount + ' with source warnings) will be staged as review drafts. ' +
          'All skipped and no-change pointers stay unchanged. No CII edits yet.';
        attestationPanel.hidden = false;
        attestationPanel.scrollIntoView?.({ block:'nearest' });
        attestationAccept.focus();
        return;
      }
      attestationPanel.hidden = true;
      stage.disabled = true;
      summary.textContent = 'Verifying exact RIGID pointer edits, full CII reparse and untouched-byte parity…';
      try {
        const verification = await stageAndVerify(chosen, current.thresholdPct, confirm.checked);
        retainSummary(current, chosen.map((r) => r.pointer), { mode: 'STAGED_REVIEW_DRAFT',
          sourceSha256: verification?.audit?.originalSha256 || '',
          revisedSha256: verification?.audit?.revisedSha256 || '',
          untouchedBytesEqual: verification?.audit?.untouchedBytesEqual === true,
          changeCount: verification?.audit?.changes?.length ?? -1 });
        close();
      } catch (error) {
        summary.textContent = 'REFUSED: ' + (error?.message || error) + '. No batch changes were staged.';
        updateStage();
      }
    };
    stage.addEventListener('click', stageSelected);
    attestationCancel.addEventListener('click', () => {
      attestationPanel.hidden = true;
      stage.focus();
    });
    attestationAccept.addEventListener('click', () => {
      if (attestationPanel.hidden) return;
      // This deliberate click records review acknowledgement, not physical
      // mass approval. Apply Nearest/Approve All never sets this automatically.
      confirm.checked = true;
      attestationPanel.hidden = true;
      updateStage();
      void stageSelected();
    });
    render();
    dialogLayer.querySelector('[data-final-rigid-batch-cancel]').focus();
  });
  return { toolbar, close };
}
