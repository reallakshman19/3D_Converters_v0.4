import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('fast Mode A runner preserves sequential isolation while removing per-source full renders', () => {
  const source = read('../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-run-workflow-mode-a-fast.js');
  assert.match(source, /runModeABatchFastFromUi/u);
  assert.match(source, /clearModeASourceCaches\(\)/u);
  assert.match(source, /await runSingleWorkflow\(isolatedRef, \(\) => \{\}\)/u);
  assert.match(source, /await yieldUi\(\)/u);
  assert.match(source, /downloadModeACiiZip\(batchRunResult\)/u);
  assert.doesNotMatch(source, /Promise\.all\([^)]*runSingleWorkflow/u);

  // The first loop enumerates PRE-RUN source mass issues, and intentional
  // preflight errors may render once. Performance invariant applies only to
  // the second loop that actually converts each independent XML model.
  const conversionStart = source.indexOf('const rows = [];');
  const loopStart = source.indexOf(
    'for (let index = 0; index < enabled.length; index += 1)',conversionStart);
  const loopEnd = source.indexOf('const succeeded = rows.filter',loopStart);
  assert.ok(loopStart >= 0 && loopEnd > loopStart);
  const loop = source.slice(loopStart, loopEnd);
  assert.doesNotMatch(loop, /render\?\.\(\)|render\(\)/u);
});

test('Finalize Run exposes one-click ZIP action without bypassing review gates', () => {
  const source = read('../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-events-mode-a-consolidated-review-v2.js');
  assert.match(source, /Finalize, Run & Download ZIP/u);
  assert.match(source, /runModeABatchFastFromUi/u);
  assert.match(source, /downloadZip/u);
  assert.match(source, /Review\/readiness gates are not bypassed/u);
});

test('consolidated Weight Match restores native controls and keeps bulk preferred acceptance exact-only', () => {
  const source = read('../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-mode-a-weight-tools.js');
  assert.match(source, /Build Weight Data — All XML/u);
  assert.match(source, /Use Rating as per DTXR/u);
  assert.match(source, /Use all ★ preferred \(exact\)/u);
  assert.match(source, /⇄ in→mm/u);
  assert.match(source, /best\.preferred/u);
  assert.match(source, /score\(best\) !== '100%'/u);
  assert.match(source, /isUnsafeBulk\(best\)/u);
  assert.match(source, /does not write DTXR Rating into Preview/u);
  assert.match(source, /delete row\._modeAWeightDtxrBest/u);
});

test('simple consolidated Weight Match acceptance persists in place instead of rebuilding all XMLs', () => {
  const source = read('../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-mode-a-consolidated-easy-weight-ui.js');
  assert.match(source, /function markAppliedRows/u);
  assert.match(source, /row\.mapped=true/u);
  assert.match(source, /row\.weightSource='override'/u);
  const applyStart = source.indexOf('function apply(panel,result,stateRef,changes,label)');
  const addRowsStart = source.indexOf('function addRowActions', applyStart);
  assert.ok(applyStart >= 0 && addRowsStart > applyStart);
  assert.doesNotMatch(source.slice(applyStart, addRowsStart), /rebuild\(panel\)/u);
});

test('consolidated rigid review restores DTXR and all-suggestion helpers but not Skip Review', () => {
  const source = read('../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-mode-a-rigid-review-tools.js');
  assert.match(source, /Use DTXR Ratings & Refresh/u);
  assert.match(source, /Use All Approved Source Weights/u);
  assert.match(source, /modeARigidApproved !== 'true'/u);
  assert.match(source, /stageRigidReviewProposal\\(input,\\{weight,approved:true/u);
  assert.match(source, /not committed until Apply Weights and Run All Models/u);
  // A still-mounting dialog must remain retryable, and DTXR must not depend
  // on column order (the optional Source XML column is easily hidden).
  assert.ok(source.indexOf('if (!controls) return false;') <
    source.indexOf("dialog.dataset.modeARigidExtraTools = 'true';"));
  assert.match(source, /row\\.querySelector\\('\\[data-dtxr-source-path\\]'\\)/u);
  assert.doesNotMatch(source, /Skip Review/u);
});

test('multi-file Preview Weight and Run use compact detail presentation', () => {
  const source = read('../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-mode-a-compact-ui.js');
  assert.match(source, /Consolidated only \(fastest\)/u);
  assert.match(source, /open one XML only when needed/u);
  assert.match(source, /toggle\.textContent = `Show \$\{label\}`/u);
  assert.match(source, /'per-file readiness'/u);
  assert.match(source, /'per-file results'/u);
  assert.match(source, /detail\.style\.display = 'none'/u);
});


test('late-mounted EF-05 review controls retry; DTXR reads source cell; only approved masses can be filled', async () => {
  const originalDocument=globalThis.document;
  const originalMutationObserver=globalThis.MutationObserver;
  let observeUpdate, ready=false, refreshes=0;
  const ratingInput={value:'',style:{}};
  const massInput={value:'',dataset:{},style:{},closest:()=>row};
  const dtxrCell={textContent:'GASKET SPIRAL WOUND 300#'};
  const candidate={dataset:{modeARigidApproved:'false',modeARigidWeight:'15'}};
  const row={
    style:{display:''},children:[null,null,null,null,null,{textContent:'447.4 mm'}],
    querySelector(selector){
      if(selector==='.mc-rigid-review-rating-input')return ratingInput;
      if(selector==='.mc-rigid-review-input')return massInput;
      if(selector==='[data-dtxr-source-path]')return dtxrCell;
      if(selector==='[data-mode-a-rigid-candidate]')return candidate;
      return null;
    },
  };
  const controls={appendChild(){}};
  const refresh={parentElement:controls,click(){refreshes+=1;}};
  const exact={parentElement:controls,insertAdjacentElement(){}};
  const dialog={
    textContent:'Rigid Weights Need Review — Consolidated',
    dataset:{},
    querySelector(selector){
      if(!ready)return null;
      if(selector==='[data-mode-a-rigid-refresh]')return refresh;
      if(selector==='[data-mode-a-rigid-fill-exact]')return exact;
      return null;
    },
    querySelectorAll:()=>[row],
  };
  const created=[];
  globalThis.document={
    documentElement:{dataset:{}},body:{},
    querySelectorAll:()=>[dialog],
    createElement:()=>{
      const node={
        dataset:{},style:{},handlers:{},
        addEventListener(name,handler){this.handlers[name]=handler;},
        insertAdjacentElement(){},
        click(){this.handlers.click?.();},
      };
      created.push(node);
      return node;
    },
  };
  globalThis.MutationObserver=class{
    constructor(callback){observeUpdate=callback;}
    observe(){}
  };
  try {
    const {installModeAConsolidatedRigidReviewTools}=await import(
      '../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-mode-a-rigid-review-tools.js');
    assert.equal(installModeAConsolidatedRigidReviewTools(),true);
    assert.equal(dialog.dataset.modeARigidExtraTools,undefined,
      'Do not mark an incompletely mounted popup as installed');
    ready=true;
    observeUpdate();
    assert.equal(dialog.dataset.modeARigidExtraTools,'true');
    const dtxr=created.find(button=>button.dataset.modeARigidUseDtxr==='true');
    const all=created.find(button=>button.dataset.modeARigidFillAllSuggestions==='true');
    assert.ok(dtxr&&all);
    dtxr.click();
    assert.equal(ratingInput.value,'300');
    assert.equal(refreshes,1);
    all.click();
    assert.equal(massInput.value,'','Unapproved catalogue draft must stay out of the input');
    candidate.dataset.modeARigidApproved='true';
    all.click();
    assert.equal(massInput.value,'15');
    assert.equal(massInput.dataset.rigidSuggestionDraft,'approved');
  } finally {
    if(originalDocument===undefined)delete globalThis.document;
    else globalThis.document=originalDocument;
    if(originalMutationObserver===undefined)delete globalThis.MutationObserver;
    else globalThis.MutationObserver=originalMutationObserver;
  }
});
