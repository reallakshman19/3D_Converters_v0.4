// Phase 6 uses the same source-specific engineering acceptance that the
// conversion-time Mode A gate uses. The legacy Weight Match engine is retained
// for candidate computation, validation and other consumers, but this phase
// does not instantiate its competing source-mass editing table.
import {
  collectModeARigidWeightReviewIssues,
  openModeAConsolidatedRigidWeightReviewPopup,
} from './xml-cii-adapted-rigid-review-mode-a.js?v=20261109-ef05-dtxr-phase6-r5';
import { applyModeAConsolidatedRigidReviewUpdates } from './xml-cii-adapted-rigid-review-mode-a-state.js';
import { xmlCiiEnrichedConfigFromState, saveMasterContextToLocalStorage } from './xml-cii-adapted-state.js';
import { modeAExecutionRows, modeARawState } from './xml-cii-adapted-mode-a-propagation.js';
import { replaceModeAState } from './xml-cii-adapted-mode-a-state.js';
import { normalizeModeABatchState, syncActiveModeASource } from '../xml-cii-mode-a-batch.js';
import { appendEmpiricalWeightValidationReport } from './xml-cii-adapted-weight-validation-report.js';
import { detectXmlCiiWorkflowSourceKind } from '../xml-cii-workflow-source-detect.js';

const esc = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const parse = raw => { try { return JSON.parse(String(raw || '{}')) || {}; } catch { return {}; } };
const count = value => Object.keys(value && typeof value==='object'?value:{}).length;

export function phase6ReviewSingleSourceId() { return 'PHASE6-SINGLE-XML'; }

/** Reuse the same strict source-key / positive-weight / receipt / skip writer as
 * consolidated Mode A. Never make independent mass approval from ranking data.
 */
export function applyPhase6SingleReview(state = {}, updates = {}) {
  const sourceId=phase6ReviewSingleSourceId();
  if(!updates[sourceId]) return state;
  const virtual = {
    supportConfigJson: state.supportConfigJson || '{}',
    sourceBatch:{activeSourceId:sourceId,sources:[{
      sourceId,supportConfigJson:state.supportConfigJson || '{}',
    }]},
  };
  const result=applyModeAConsolidatedRigidReviewUpdates(virtual,updates);
  const supportConfigJson=result.sourceBatch.sources[0].supportConfigJson;
  if(supportConfigJson===state.supportConfigJson)return state;
  return {
    ...state,supportConfigJson,
    phase6Undo:{mode:'single',supportConfigJson:state.supportConfigJson||'{}',
      sourceText:state.sourceText||'',stagedJsonText:state.stagedJsonText||''},
    masterContext:state.masterContext
      ? {...state.masterContext,config:parse(supportConfigJson)}
      : state.masterContext,
    weightMatchResult:null,
    weightMatchStatus:'Rigid physical masses reviewed in Phase 6.',
    pendingPhase6MassReview:null,
    outputRunReadinessReport:null,result:null,
  };
}

export function applyPhase6ModeAReview(state = {}, updates = {}) {
  if(!Object.keys(updates).length)return state;
  const original=Object.fromEntries((state.sourceBatch?.sources||[])
    .filter(source=>Object.prototype.hasOwnProperty.call(updates,source.sourceId))
    .map(source=>[source.sourceId,source.supportConfigJson||'{}']));
  const sourceIdentity=Object.fromEntries((state.sourceBatch?.sources||[])
    .filter(source=>Object.prototype.hasOwnProperty.call(updates,source.sourceId))
    .map(source=>[source.sourceId,{
      sourceDigest:source.sourceDigest||'',sourceText:source.sourceText||'',
      stagedJsonText:source.stagedJsonText||'',
    }]));
  const applied=applyModeAConsolidatedRigidReviewUpdates(state,updates);
  const sources=(applied.sourceBatch?.sources||[]).map(source=>
    updates[source.sourceId] ? {
      ...source,
      workflow:{...(source.workflow||{}),weightMatchResult:null,
        outputRunReadinessReport:null,result:null},
    } : source);
  return syncActiveModeASource(normalizeModeABatchState({
    ...applied,phase6Undo:{mode:'batch',sourceConfigs:original,sourceIdentity},
    pendingPhase6MassReview:null,
    sourceBatch:{...applied.sourceBatch,sources},
    weightMatchResult:null,outputRunReadinessReport:null,
    batchRunResult:null,result:null,
  }));
}

/** Undo the LAST saved Phase 6 transaction, including mass receipt and skip
 * custody. Never undo an unrelated source or a later conversion run.
 */
export function undoPhase6Review(state = {}) {
  const saved=state.phase6Undo;
  if(!saved)return state;
  if(saved.mode==='single'){
    // Never replay a previous source's approval/weight ledger onto a newly
    // loaded XML or a different staged-geometry authority.
    if((state.sourceText||'')!==(saved.sourceText||'') ||
       (state.stagedJsonText||'')!==(saved.stagedJsonText||''))return state;
    const supportConfigJson=saved.supportConfigJson||'{}';
    return {...state,phase6Undo:null,supportConfigJson,
      weightMatchResult:null,result:null,outputRunReadinessReport:null,
      masterContext:state.masterContext?{...state.masterContext,
        config:parse(supportConfigJson)}:state.masterContext};
  }
  if(saved.mode!=='batch')return state;
  const sourceConfigs=saved.sourceConfigs||{};
  const identity=saved.sourceIdentity||{};
  if((state.sourceBatch?.sources||[]).some(source=>{
    const expected=identity[source.sourceId];
    return expected && (
      (source.sourceDigest||'')!==(expected.sourceDigest||'') ||
      (source.sourceText||'')!==(expected.sourceText||'') ||
      (source.stagedJsonText||'')!==(expected.stagedJsonText||'')
    );
  }))return state;
  const sources=(state.sourceBatch?.sources||[]).map(source=>
    Object.prototype.hasOwnProperty.call(sourceConfigs,source.sourceId)
      ? {...source,supportConfigJson:sourceConfigs[source.sourceId],
        workflow:{...(source.workflow||{}),result:null,
          outputRunReadinessReport:null,weightMatchResult:null}}
      : source);
  const active=sources.find(source=>source.sourceId===state.sourceBatch?.activeSourceId);
  return syncActiveModeASource(normalizeModeABatchState({
    ...state,phase6Undo:null,result:null,batchRunResult:null,
    outputRunReadinessReport:null,weightMatchResult:null,
    supportConfigJson:active?.supportConfigJson||state.supportConfigJson,
    sourceBatch:{...state.sourceBatch,sources},
  }));
}

async function sourceText(state,key,fileKey){
  if(String(state?.[key]||'').trim())return state[key];
  const file=state?.[fileKey];
  return file?.text ? await file.text() : '';
}

export async function phase6CollectReviewEntries(stateRef, modeA = false) {
  const list=modeA
    ? modeAExecutionRows(stateRef).map(({source,state})=>({
        sourceId:source.sourceId,fileName:source.fileName,
        alias:source.alias,state,
      }))
    : [{
      sourceId:phase6ReviewSingleSourceId(),
      fileName:stateRef.current?.sourceFile?.name || stateRef.current?.sourceNameOverride || 'Source XML',
      state:stateRef.current,
    }];
  const entries=[];
  // Failure in ANY source must prevent a partial stale batch review.
  for(const row of list){
    const state={...row.state,
      sourceText:await sourceText(row.state,'sourceText','sourceFile'),
      stagedJsonText:await sourceText(row.state,'stagedJsonText','stagedJsonFile')};
    if(!state.sourceText.trim())throw new Error('Source XML missing for '+row.fileName);
    const config=xmlCiiEnrichedConfigFromState(state);
    const issues=await collectModeARigidWeightReviewIssues(state,config,{
      includeSkipped:true,includeMapped:true,
      // The full Phase 6 workbench keeps existing approved and XML masses
      // editable. The conversion-time gate continues to collect only missing.
    });
    entries.push({...row,state,config,issues});
  }
  return entries;
}

function clearPhase6StateAfterMatchingChange(state = {}) {
  return {...state,weightMatchResult:null,outputRunReadinessReport:null,
    result:null,batchRunResult:null};
}

const PHASE6_SHARED_RULE_KEYS=Object.freeze([
  'convertSmallLengthsInToMm','valveHintLengthToleranceMm',
  'semanticKeywordRules','specialValveFactorRules','valveHintMapping',
]);
export function phase6RuleSettingsOnly(weight = {}) {
  const result={};
  for(const key of PHASE6_SHARED_RULE_KEYS)
    if(Object.prototype.hasOwnProperty.call(weight,key))result[key]=weight[key];
  return result;
}

function phase6SaveAdvancedSettings(stateRef, modeA, nextConfig, render) {
  // Never broadcast the active XML's imported master rows or finalized
  // physical masses into another source merely because a rule was edited.
  const rules=phase6RuleSettingsOnly(nextConfig.weight||{});
  if(modeA){
    const before=modeARawState(stateRef);
    const shared=parse(before.sourceBatch?.sharedSupportConfigJson || before.supportConfigJson);
    shared.weight={...(shared.weight||{}),...rules};
    const sources=(before.sourceBatch?.sources||[]).map(source=>{
      const config=parse(source.supportConfigJson);
      config.weight={...(config.weight||{}),...rules};
      return {...source,supportConfigJson:JSON.stringify(config,null,2),
        workflow:clearPhase6StateAfterMatchingChange(source.workflow||{})};
    });
    const active=sources.find(source=>source.sourceId===before.sourceBatch?.activeSourceId);
    replaceModeAState(stateRef,{
      ...clearPhase6StateAfterMatchingChange(before),
      supportConfigJson:active?.supportConfigJson || before.supportConfigJson,
      sourceBatch:{...before.sourceBatch,
        sharedSupportConfigJson:JSON.stringify(shared,null,2),sources},
    });
  }else{
    const current=stateRef.current||{};
    const config=parse(current.supportConfigJson);
    config.weight={...(config.weight||{}),...rules};
    const supportConfigJson=JSON.stringify(config,null,2);
    stateRef.current={...clearPhase6StateAfterMatchingChange(current),
      supportConfigJson,
      masterContext:current.masterContext
        ? {...current.masterContext,config}
        : current.masterContext,
    };
    if(stateRef.current.masterContext)
      saveMasterContextToLocalStorage(stateRef.current.masterContext);
  }
  render?.();
}

function isExplicitZeroSkip(entry, issue) {
  const record=entry.config?.overrides?.rigidWeightSkipped?.[issue.key];
  return record?.skipped===true && Number(record.weightKg)===0;
}

function summaryHtml(entries) {
  return `<table data-phase6-source-summary style="border-collapse:collapse;width:100%;font-size:12px;margin:8px 0;">
    <thead><tr style="background:#1e293b;color:#e8f2ff;">
      <th style="text-align:left;padding:8px;">XML source</th>
      <th style="text-align:right;padding:8px;">Requires review</th>
      <th style="text-align:right;padding:8px;">Mapped</th>
      <th style="text-align:right;padding:8px;">Suggested drafts</th>
      <th style="text-align:right;padding:8px;">Intentional 0kg skips</th>
      <th style="text-align:left;padding:8px;">Scope</th></tr></thead>
    <tbody>${entries.map(entry=>{
      const skipped=entry.issues.filter(issue=>isExplicitZeroSkip(entry,issue)).length;
      const mapped=entry.issues.filter(issue=>issue.mapped).length;
      const suggestions=entry.issues.filter(issue=>!issue.mapped && !isExplicitZeroSkip(entry,issue) &&
        (issue.candidates?.length||issue.unknownComponentSuggestion?.ok)).length;
      return `<tr><td style="padding:7px;border-bottom:1px solid #334155;">${esc(entry.fileName)}</td>
        <td style="padding:7px;text-align:right;">${entry.issues.length-skipped-mapped}</td>
        <td style="padding:7px;text-align:right;">${mapped}</td>
        <td style="padding:7px;text-align:right;">${suggestions}</td>
        <td style="padding:7px;text-align:right;">${skipped}</td>
        <td style="padding:7px;">${esc(entry.alias||'Source-local')}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

/** Read-only audit ledger. Masses may only be changed in the same
 * consolidated popup, not through an extra editable Weight Match table.
 */
export function phase6MassLedger(entries = []) {
  const result=[];
  for(const entry of entries){
    const overrides=entry.config?.overrides||{};
    const skipped=overrides.rigidWeightSkipped||{};
    for(const issue of entry.issues||[]){
      const zero=isExplicitZeroSkip(entry,issue);
      const proposed=issue.candidates?.[0]?.selectedWeight ??
        issue.candidates?.[0]?.suggestedWeight ??
        issue.unknownComponentSuggestion?.suggestedKg;
      result.push({
        sourceId:entry.sourceId,fileName:entry.fileName,
        key:issue.key,branchName:issue.branchName||'',
        ref:(issue.componentRefNo||'')+(issue.endpoint?'_'+issue.endpoint:''),
        status:zero?'skipped':issue.mapped ? (
          (()=>{const receipt=overrides.rigidWeightReviewReceipts?.[issue.key];
            return receipt?.reviewed===true &&
              Math.abs(Number(receipt.weightKg)-Number(issue.weight))<1e-9
              ?'reviewed':'saved';})()) : 'pending',
        kg:zero?0:(issue.mapped?Number(issue.weight):null),
        suggestedKg:Number(proposed)>0?Number(proposed):null,
      });
    }
    for(const [key,value] of Object.entries(overrides.rigidWeight||{})){
      const kg=Number(value);
      if(!Number.isFinite(kg)||kg<=0)continue;
      if(result.some(row=>row.sourceId===entry.sourceId&&row.key===key))continue;
      const receipt=overrides.rigidWeightReviewReceipts?.[key];
      const reviewed=receipt?.reviewed===true &&
        Math.abs(Number(receipt.weightKg)-kg)<1e-9;
      result.push({
        sourceId:entry.sourceId,fileName:entry.fileName,key,
        branchName:key.split('::')[0]||'',
        ref:receipt?.sourceComponentRef || key.split('::')[1] || key,
        status:reviewed?'reviewed':'saved',
        kg,suggestedKg:null,
      });
    }
  }
  return result;
}
function phase6LedgerHtml(entries) {
  const rows=phase6MassLedger(entries);
  if(!rows.length)return '<p>No stored mass decisions or missing components.</p>';
  const td=(v)=>`<td style="padding:6px 9px;border-bottom:1px solid #334155;overflow-wrap:anywhere;">${esc(v)}</td>`;
  return `<details data-phase6-ledger style="margin:12px 0;">
    <summary style="cursor:pointer;font-weight:650;color:#d7e6ff;">
      Inspect all physical-mass decisions (${rows.length}) — read only
    </summary>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;">
      <input type="search" data-phase6-ledger-search placeholder="Find XML, branch or source reference…"
        style="min-width:220px;background:#101827;color:white;border:1px solid #475569;padding:7px;">
      <select data-phase6-ledger-filter
        style="background:#101827;color:white;border:1px solid #475569;padding:7px;">
        <option value="">All statuses</option>
        <option value="pending">Needs review</option>
        <option value="reviewed">Independently reviewed</option>
        <option value="saved">Saved source mass</option>
        <option value="skipped">Intentional 0 kg skip</option>
      </select>
    </div>
    <div style="overflow:auto;max-height:48vh;border:1px solid #334155;border-radius:6px;">
      <table style="border-collapse:collapse;width:100%;min-width:790px;font-size:12px;">
        <thead><tr style="position:sticky;top:0;background:#1e293b;color:#e4f2ff;">
          ${['Source XML','Branch','Source component / key','Status','Saved kg','Suggested draft kg'].map(h=>
            `<th style="padding:8px;text-align:left;">${h}</th>`).join('')}
        </tr></thead>
        <tbody>${rows.map(row=>`<tr data-phase6-ledger-row
          data-phase6-ledger-status="${row.status}"
          data-phase6-ledger-search-text="${esc([row.fileName,row.branchName,row.ref,row.key].join(' ').toLowerCase())}">
          ${td(row.fileName)}${td(row.branchName)}${td(row.ref||row.key)}
          ${td(row.status)}${td(row.kg??'—')}${td(row.suggestedKg??'—')}
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <p style="font-size:11px;color:#9fb5d1;">
      Suggestions are evidence, not approved masses. Reopen Review / Edit Rigid Weights to change a decision.
    </p>
  </details>`;
}

/** Phase 6 replaces the duplicate editable Weight Match table. Run still
 * invokes the consolidated check independently, even if Phase 6 was skipped.
 */
export function renderUnifiedPhase6WeightReview(card, stateRef, render, {modeA=false}={}) {
  if(!card)return;
  const snapshot=modeA?modeARawState(stateRef):stateRef.current||{};
  // Source mode compatibility: the consolidated endpoint-2 physical-mass
  // collector is PSI116-specific. Preserve InputXML's pre-existing Weight
  // Match route rather than interpreting its rows as PSI116 or losing edits.
  const sourceMode=String(snapshot.sourceKind||'auto').toLowerCase();
  if(!modeA && (sourceMode==='inputxml' ||
       (sourceMode==='auto' && detectXmlCiiWorkflowSourceKind(
         String(snapshot.sourceText||''))==='inputxml'))){
    card.textContent='Loading InputXML-compatible Weight Match review…';
    void import('./xml-cii-adapted-weight-match-v2.js?v=20261108-rigid-choice-buttons-1')
      .then(module=>module.renderAdaptedWeightMatchPanelV2(card,stateRef))
      .catch(error=>{card.textContent='InputXML weight review unavailable: '+error.message;});
    return;
  }
  const executionSources=modeA?modeAExecutionRows(stateRef):[];
  const sourceCount=modeA?executionSources.length:1;
  const config=modeA
    ? xmlCiiEnrichedConfigFromState(modeAExecutionRows(stateRef)[0]?.state||snapshot)
    : xmlCiiEnrichedConfigFromState(snapshot);
  const sourceConfigs=modeA?executionSources.map(row=>
    xmlCiiEnrichedConfigFromState(row.state)):[config];
  const overrideCount=sourceConfigs.reduce((sum,c)=>sum+count(c.overrides?.rigidWeight),0);
  const receiptCount=sourceConfigs.reduce((sum,c)=>sum+count(c.overrides?.rigidWeightReviewReceipts),0);
  const savedNotice = snapshot.phase6Undo ? '<div data-phase6-saved-preview-status role="status" style="padding:9px;margin:8px 0;border:1px solid #4a80ad;border-radius:6px;background:#102840;color:#d0eaff;font-size:12px;">SAVED SOURCE KG — NO CII RE-EXTRACTION YET. The ledger below shows source-component weights, not final post-split RIGID ownership. Run conversion and review final emitted pointers; unresolved short spans require documented REVIEW-ONLY edits.</div>' : '';
  card.innerHTML=`
    <div class="model-converters-workflow-detail-title">
      Rigid Weights Need Review — Consolidated
    </div>
    ${snapshot.pendingPhase6MassReview ? `<div data-phase6-run-redirect
      style="margin:8px 0;padding:10px;border-radius:6px;border:1px solid #e4ae43;
      background:#352810;color:#ffe7b4;font-size:12px;">
      RUN PAUSED — source mass review required before conversion.
      ${Number(snapshot.pendingPhase6MassReview.issueCount||0)} unresolved
      physical-component mass(es). Use Review / Edit Rigid Weights, save
      independently verified masses or explicit 0 kg skips, then return
      to 10 Output / Run and run again. Nothing has been converted or
      automatically approved by this redirect.</div>` : ''}
    <p class="model-converters-workflow-detail-text">
      The same physical-mass approval gate used by Run is available here before conversion.
      Suggestions stage kg values; neither a catalog score nor a button click approves mass.
      Saved weights and explicit zero skips stay attached to their originating XML.
    </p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0;">
      <button type="button" class="model-converters-run-btn"
        data-phase6-open-review>Review / Edit Rigid Weights</button>
      <button type="button" class="model-converters-download-btn"
        data-phase6-refresh-review>Recheck missing weights</button>
      <button type="button" class="model-converters-download-btn"
        data-phase6-undo ${snapshot.phase6Undo?'':'disabled'}
        title="Restore the last saved source-mass transaction with its receipts and skips">
        ↶ Undo Last Change</button>
      <span style="color:#9cc5ff;font-size:12px;">${sourceCount} XML source(s) ·
        ${overrideCount} saved positive masses · ${receiptCount} review receipts
      </span>
    </div>
    ${savedNotice}
    <div data-phase6-status role="status" aria-live="polite"
      style="font-size:12px;margin:8px 0;color:#9cc5ff;">Recheck to inspect pending source masses.</div>
    <div data-phase6-sources></div>
    <details data-phase6-advanced class="model-converters-workflow-master-card"
      style="margin-top:14px;padding:10px;border:1px solid #31455f;border-radius:8px;">
      <summary style="cursor:pointer;color:#d7e6ff;font-weight:700;">
        Advanced matching rules and physical-mass validation
      </summary>
      <div data-phase6-settings style="margin:10px 0;"></div>
      <button type="button" id="mc-wm-refresh"
        class="model-converters-download-btn">Build source-mass validation data</button>
      <div data-phase6-validation></div>
    </details>
  `;
  const status=card.querySelector('[data-phase6-status]');
  const output=card.querySelector('[data-phase6-sources]');
  const review=card.querySelector('[data-phase6-open-review]');
  const refresh=card.querySelector('[data-phase6-refresh-review]');
  card.querySelector('[data-phase6-undo]')?.addEventListener('click',()=>{
    const before=modeA?modeARawState(stateRef):stateRef.current;
    if(!before?.phase6Undo)return;
    const next=undoPhase6Review(before);
    if(next===before){
      const message=card.querySelector('[data-phase6-status]');
      if(message)message.textContent='Undo refused: source XML or staged geometry changed since this mass edit.';
      return;
    }
    if(modeA)replaceModeAState(stateRef,next);
    else{
      stateRef.current=next;
      if(next.masterContext)saveMasterContextToLocalStorage(next.masterContext);
    }
    render?.();
  });
  const reportTarget=card.querySelector('[data-phase6-validation]');
  const sourceRows=modeA?modeAExecutionRows(stateRef):[];
  let selectedSourceId=sourceRows[0]?.source?.sourceId||'';
  const reportRef={current:modeA?(sourceRows[0]?.state||snapshot):snapshot};
  if(modeA && sourceRows.length>1){
    const select=document.createElement('select');
    select.dataset.phase6ValidationSource='true';
    select.style.cssText='background:#101827;color:#fff;padding:6px;margin:10px 0;border:1px solid #475569;';
    for(const {source} of sourceRows){
      const option=document.createElement('option');
      option.value=source.sourceId;option.textContent=source.fileName;select.appendChild(option);
    }
    select.addEventListener('change',()=>{
      selectedSourceId=select.value;
      reportRef.current=modeAExecutionRows(stateRef)
        .find(row=>row.source.sourceId===selectedSourceId)?.state||{};
    });
    reportTarget.before(select);
  }
  appendEmpiricalWeightValidationReport(card.querySelector('[data-phase6-advanced]'),reportRef);
  const settings=card.querySelector('[data-phase6-settings]');
  void import('../../model-converters/converters/xmltocii2019_helper/weight-match-renderer.js?v=20261109-phase6-readable-table-r4')
    .then(module=>module.mountXmlCiiWeightRuleSettings(settings,{
      config,onSaveConfig:next=>phase6SaveAdvancedSettings(stateRef,modeA,next,render),
    })).catch(error=>{if(settings)settings.textContent='Advanced settings unavailable: '+error.message;});
  const setStatus=(value,bad=false)=>{
    if(status){status.textContent=value;status.style.color=bad?'#fca5a5':'#9cc5ff';}
  };
  const load=async()=>{
    const entries=await phase6CollectReviewEntries(stateRef,modeA);
    if(output){
      output.innerHTML=summaryHtml(entries)+phase6LedgerHtml(entries);
      if(snapshot.phase6Undo){
        const ledger=output.querySelector('[data-phase6-ledger]');
        if(ledger)ledger.open=true;
      }
      const searchInput=output.querySelector('[data-phase6-ledger-search]');
      const statusFilter=output.querySelector('[data-phase6-ledger-filter]');
      const applyFilter=()=>{
        const query=String(searchInput?.value||'').trim().toLowerCase();
        const filter=String(statusFilter?.value||'');
        output.querySelectorAll('[data-phase6-ledger-row]').forEach(row=>{
          const matches=(!filter||row.dataset.phase6LedgerStatus===filter) &&
            (!query||(row.dataset.phase6LedgerSearchText||'').includes(query));
          row.style.display=matches?'':'none';
        });
      };
      searchInput?.addEventListener('input',applyFilter);
      statusFilter?.addEventListener('change',applyFilter);
    }
    const unresolved=entries.reduce((n,e)=>n+
      e.issues.filter(issue=>!issue.mapped&&!isExplicitZeroSkip(e,issue)).length,0);
    const skipped=entries.reduce((n,e)=>n+
      e.issues.filter(issue=>isExplicitZeroSkip(e,issue)).length,0);
    setStatus(unresolved+' unresolved source physical masses across '+
      entries.length+' XML file(s); '+skipped+
      ' previously skipped 0kg physical components (re-editable).');
    return entries;
  };
  if(snapshot.phase6Undo){
    setStatus('Loading saved source-component weights (kg), receipts and unresolved rows…');
    void load().catch(error=>setStatus('Saved weight preview failed: '+error.message,true));
  }
  refresh?.addEventListener('click',async()=>{
    refresh.disabled=true;setStatus('Rechecking source identity, Preview Rating and master suggestions…');
    try{await load();}catch(error){setStatus('Weight recheck failed: '+error.message,true);}
    finally{refresh.disabled=false;}
  });
  review?.addEventListener('click',async()=>{
    review.disabled=true;setStatus('Building independent physical-mass review…');
    try{
      const entries=await load();
      const pending=entries.filter(row=>row.issues.length);
      if(!pending.length){
        setStatus('No missing physical-component masses. Nothing changed.');
        return;
      }
      const result=await openModeAConsolidatedRigidWeightReviewPopup(pending,{phase6:true});
      if(result.cancelled){
        setStatus('Rigid-mass review cancelled. No source mass was changed.');
        return;
      }
      if(!Object.keys(result.updates||{}).length){
        setStatus('No source weight or Rating changed.');
        return;
      }
      if(modeA){
        replaceModeAState(stateRef,applyPhase6ModeAReview(modeARawState(stateRef),result.updates));
      }else{
        stateRef.current=applyPhase6SingleReview(stateRef.current,result.updates);
        if(stateRef.current.masterContext)
          saveMasterContextToLocalStorage(stateRef.current.masterContext);
      }
      render?.();
    }catch(error){setStatus('Rigid-mass review failed: '+error.message,true);}
    finally{review.disabled=false;}
  });
  card.querySelector('#mc-wm-refresh')?.addEventListener('click',async()=>{
    setStatus('Computing source masses for independent validation…');
    try{
      const row=modeA
        ? modeAExecutionRows(stateRef).find(x=>x.source.sourceId===selectedSourceId)?.state
        : stateRef.current;
      if(!row)throw new Error('Select a valid XML source');
      const [{computeXmlCiiWeightIssues},{loadParentWeightMatchModules}]=await Promise.all([
        import('../../model-converters/converters/xmltocii2019_helper/weight-match-renderer.js?v=20261109-phase6-readable-table-r4'),
        import('../xml-cii-standalone-run-parity.js')
      ]);
      const file=row.sourceFile || new File([await sourceText(row,'sourceText','sourceFile')],
        'source.xml',{type:'application/xml'});
      const {enrichXmlForCii2019}=await loadParentWeightMatchModules();
      const data=await computeXmlCiiWeightIssues({
        xmlFile:file,stagedJsonText:await sourceText(row,'stagedJsonText','stagedJsonFile'),
        config:xmlCiiEnrichedConfigFromState(row),enrichXmlForCii2019,
      });
      if(!data)throw new Error('Weight reference data could not be computed');
      reportTarget.dispatchEvent(new CustomEvent('xml-cii-weight-validator-ready',{
        bubbles:true,detail:data,
      }));
      setStatus('Source-local empirical validation data refreshed.');
    }catch(error){setStatus('Validation unavailable: '+error.message,true);}
  });
}
