// Phase 6 uses the same source-specific engineering acceptance that the
// conversion-time Mode A gate uses. The legacy Weight Match engine is retained
// for candidate computation, validation and other consumers, but this phase
// does not instantiate its competing source-mass editing table.
import {
  collectModeARigidWeightReviewIssues,
  openModeAConsolidatedRigidWeightReviewPopup,
} from './xml-cii-adapted-rigid-review-mode-a.js?v=20261108-rigid-choice-buttons-1';
import { applyModeAConsolidatedRigidReviewUpdates } from './xml-cii-adapted-rigid-review-mode-a-state.js';
import { xmlCiiEnrichedConfigFromState, saveMasterContextToLocalStorage } from './xml-cii-adapted-state.js';
import { modeAExecutionRows, modeARawState } from './xml-cii-adapted-mode-a-propagation.js';
import { replaceModeAState } from './xml-cii-adapted-mode-a-state.js';
import { normalizeModeABatchState, syncActiveModeASource } from '../xml-cii-mode-a-batch.js';
import { appendEmpiricalWeightValidationReport } from './xml-cii-adapted-weight-validation-report.js';

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
  return {
    ...state,supportConfigJson,
    masterContext:state.masterContext
      ? {...state.masterContext,config:parse(supportConfigJson)}
      : state.masterContext,
    weightMatchResult:null,
    weightMatchStatus:'Rigid physical masses reviewed in Phase 6.',
    outputRunReadinessReport:null,result:null,
  };
}

export function applyPhase6ModeAReview(state = {}, updates = {}) {
  if(!Object.keys(updates).length)return state;
  const applied=applyModeAConsolidatedRigidReviewUpdates(state,updates);
  const sources=(applied.sourceBatch?.sources||[]).map(source=>
    updates[source.sourceId] ? {
      ...source,
      workflow:{...(source.workflow||{}),weightMatchResult:null,
        outputRunReadinessReport:null,result:null},
    } : source);
  return syncActiveModeASource(normalizeModeABatchState({
    ...applied,sourceBatch:{...applied.sourceBatch,sources},
    weightMatchResult:null,outputRunReadinessReport:null,
    batchRunResult:null,result:null,
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
    const issues=await collectModeARigidWeightReviewIssues(state,config);
    entries.push({...row,state,config,issues});
  }
  return entries;
}

function clearPhase6StateAfterMatchingChange(state = {}) {
  return {...state,weightMatchResult:null,outputRunReadinessReport:null,
    result:null,batchRunResult:null};
}

function phase6SaveAdvancedSettings(stateRef, modeA, nextConfig, render) {
  if(modeA){
    const before=modeARawState(stateRef);
    const shared=parse(before.sourceBatch?.sharedSupportConfigJson || before.supportConfigJson);
    shared.weight={...(shared.weight||{}),...(nextConfig.weight||{})};
    const sources=(before.sourceBatch?.sources||[]).map(source=>{
      const config=parse(source.supportConfigJson);
      config.weight={...(config.weight||{}),...(nextConfig.weight||{})};
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
    config.weight={...(config.weight||{}),...(nextConfig.weight||{})};
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

function summaryHtml(entries) {
  return `<table data-phase6-source-summary style="border-collapse:collapse;width:100%;font-size:12px;margin:8px 0;">
    <thead><tr style="background:#1e293b;color:#e8f2ff;">
      <th style="text-align:left;padding:8px;">XML source</th>
      <th style="text-align:right;padding:8px;">Requires review</th>
      <th style="text-align:right;padding:8px;">Suggested drafts</th>
      <th style="text-align:left;padding:8px;">Scope</th></tr></thead>
    <tbody>${entries.map(entry=>{
      const suggestions=entry.issues.filter(issue=>issue.candidates?.length ||
        issue.unknownComponentSuggestion?.ok).length;
      return `<tr><td style="padding:7px;border-bottom:1px solid #334155;">${esc(entry.fileName)}</td>
        <td style="padding:7px;text-align:right;">${entry.issues.length}</td>
        <td style="padding:7px;text-align:right;">${suggestions}</td>
        <td style="padding:7px;">${esc(entry.alias||'Source-local')}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

/** Phase 6 replaces the duplicate editable Weight Match table. Run still
 * invokes the consolidated check independently, even if Phase 6 was skipped.
 */
export function renderUnifiedPhase6WeightReview(card, stateRef, render, {modeA=false}={}) {
  if(!card)return;
  const snapshot=modeA?modeARawState(stateRef):stateRef.current||{};
  const sourceCount=modeA?modeAExecutionRows(stateRef).length:1;
  const config=modeA
    ? xmlCiiEnrichedConfigFromState(modeAExecutionRows(stateRef)[0]?.state||snapshot)
    : xmlCiiEnrichedConfigFromState(snapshot);
  const overrideCount=count(config.overrides?.rigidWeight);
  const receiptCount=count(config.overrides?.rigidWeightReviewReceipts);
  card.innerHTML=`
    <div class="model-converters-workflow-detail-title">
      Rigid Weights Need Review — Consolidated
    </div>
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
      <span style="color:#9cc5ff;font-size:12px;">${sourceCount} XML source(s) ·
        ${overrideCount} saved positive masses · ${receiptCount} review receipts
      </span>
    </div>
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
  void import('../../model-converters/converters/xmltocii2019_helper/weight-match-renderer.js?v=20261108-phase6-unified-r1')
    .then(module=>module.mountXmlCiiWeightRuleSettings(settings,{
      config,onSaveConfig:next=>phase6SaveAdvancedSettings(stateRef,modeA,next,render),
    })).catch(error=>{if(settings)settings.textContent='Advanced settings unavailable: '+error.message;});
  const setStatus=(value,bad=false)=>{
    if(status){status.textContent=value;status.style.color=bad?'#fca5a5':'#9cc5ff';}
  };
  const load=async()=>{
    const entries=await phase6CollectReviewEntries(stateRef,modeA);
    if(output)output.innerHTML=summaryHtml(entries);
    setStatus(entries.reduce((n,e)=>n+e.issues.length,0)+
      ' unresolved source physical masses across '+entries.length+' XML file(s).');
    return entries;
  };
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
      const result=await openModeAConsolidatedRigidWeightReviewPopup(pending);
      if(result.cancelled){
        setStatus('Rigid-mass review cancelled. No source mass was changed.');
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
        import('../../model-converters/converters/xmltocii2019_helper/weight-match-renderer.js?v=20261108-phase6-unified-r1'),
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
