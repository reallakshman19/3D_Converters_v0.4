import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultRegexTesterConfig, runStandaloneRegexTester } from
  '../tabs/xml-cii-2019-standalone/xml-cii-regex-tester.js';
import { updateRegexTesterConfig, applyStandaloneRegexTesterResult } from
  '../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-state.js';
import { deriveLineKeyFromBranchName } from
  '../converters/xml-cii2019-core/regex-line-key.js';
import { _derivePipingClassFromBranchName } from
  '../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-preview-dryrun-core.js';
import { createModeASourceEntry, buildModeAExecutionState } from
  '../tabs/xml-cii-2019-standalone/xml-cii-mode-a-batch.js';
import { createModeARegexProcessingRef, modeARawState } from
  '../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-mode-a-propagation.js';

const BRANCH='/GLRD-1000-6"-P4110001-93833-01/B6';
const sourceXml = '<Root><Branch><Branchname>'+BRANCH.replace(/"/g,'&quot;')+
  '</Branchname></Branch></Root>';

test('one click-to-map line key update overrides stale regex and invalidates Preview cache',()=>{
  const oldStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem:k => values.get(k) ?? null,
    setItem:(k,v) => values.set(k,String(v)),
    removeItem:k => values.delete(k),
  };
  try {
    const regexTesterConfig=createDefaultRegexTesterConfig();
    regexTesterConfig.formats[0].lineKey = {
      regex:'-(93833)-',group:1,tokenPosition:'5',
    };
    regexTesterConfig.formats[0].pipingClass = {
      regex:'',group:1,tokenPosition:'5',
    };
    const initialConfig = {
      linelist:{branchNameRegex:'-(93833)-',lineNoGroup:1,
        lineKeyTokenPositions:'5',tokenDelimiter:'-'},
      rating:{pipingClassTokenIndex:5,tokenDelimiter:'-'},
    };
    assert.equal(deriveLineKeyFromBranchName(BRANCH,initialConfig),'93833');
    const initial = {regexTesterConfig,sourceKind:'xml',sourceText:sourceXml,
      supportConfigJson:JSON.stringify(initialConfig)};
    values.set('xml-cii-pv-cache-v8-rating-policy','OLD_EXACT_PREVIEW');
    values.set('xml-cii-pv-cache-v8-dtxr','OLD_LEGACY_PREVIEW');
    // One selection of token #4 is sufficient. No off/on workaround.
    const mapped=updateRegexTesterConfig(initial,'regex-line-key-token','4');
    assert.equal(mapped.regexTesterConfig.formats[0].lineKey.tokenPosition,'4');
    assert.equal(mapped.regexTesterConfig.formats[0].lineKey.regex,'');
    assert.equal(values.has('xml-cii-pv-cache-v8-rating-policy'),false);
    assert.equal(values.has('xml-cii-pv-cache-v8-dtxr'),false);
    const tested=runStandaloneRegexTester({
      ...mapped,sourceText:sourceXml,extractionConfig:mapped.regexTesterConfig,
    });
    const persisted=applyStandaloneRegexTesterResult(mapped,tested);
    const config=JSON.parse(persisted.supportConfigJson);
    assert.equal(config.linelist.branchNameRegex,'');
    assert.equal(config.linelist.lineKeyTokenPositions,'4');
    assert.equal(config.rating.pipingClassTokenIndex,'5');
    assert.equal(deriveLineKeyFromBranchName(BRANCH,config),'P4110001');
    assert.equal(_derivePipingClassFromBranchName(BRANCH,config),'93833');
    assert.equal(persisted.regexTesterConfig.formats[0].lineKey.tokenPosition,'4');
  } finally {
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage=oldStorage;
  }
});

test('configured regex continues to work until a token mapping is explicitly selected',()=>{
  const cfg=createDefaultRegexTesterConfig();
  cfg.formats[0].lineKey={regex:'-(93833)-',group:1,tokenPosition:'5'};
  const initial={regexTesterConfig:cfg};
  const unchanged=updateRegexTesterConfig(initial,'regex-line-key-group','1');
  assert.equal(unchanged.regexTesterConfig.formats[0].lineKey.regex,'-(93833)-');
  const mapped=updateRegexTesterConfig(initial,'regex-line-key-token','4');
  assert.equal(mapped.regexTesterConfig.formats[0].lineKey.regex,'');
  assert.equal(initial.regexTesterConfig.formats[0].lineKey.regex,'-(93833)-',
    'existing input configuration stays unchanged');
});

test('Mode A shared Regex one-click mapping reaches each source Preview config without toggling',()=>{
  const regexTesterConfig=createDefaultRegexTesterConfig();
  regexTesterConfig.formats[0].lineKey={regex:'-(93833)-',group:1,tokenPosition:'5'};
  regexTesterConfig.formats[0].pipingClass={regex:'',group:1,tokenPosition:'5'};
  const config=JSON.stringify({linelist:{branchNameRegex:'-(93833)-',lineNoGroup:1,
    lineKeyTokenPositions:'5'},rating:{pipingClassTokenIndex:5}});
  const source=createModeASourceEntry({sourceText:sourceXml,sourceFile:null,
    fileName:'GLRD-TEST.xml',supportConfigJson:config});
  const baseRef={current:{
    sourceText:sourceXml,sourceKind:'xml',sourceFile:null,
    supportConfigJson:config,regexTesterConfig,
    sourceBatch:{mode:'separate-models',activeSourceId:source.sourceId,
      sources:[source],sharedSupportConfigJson:config},
  }};
  const regexRef=createModeARegexProcessingRef(baseRef);
  regexRef.current=updateRegexTesterConfig(regexRef.current,'regex-line-key-token','4');
  const snapshot=regexRef.current;
  const result=runStandaloneRegexTester({...snapshot,sourceText:snapshot.sourceText,
    extractionConfig:snapshot.regexTesterConfig});
  regexRef.current=applyStandaloneRegexTesterResult(snapshot,result);
  const after=modeARawState(baseRef);
  const effective=buildModeAExecutionState(after,after.sourceBatch.sources[0]);
  const effectiveConfig=JSON.parse(effective.supportConfigJson);
  assert.equal(effective.regexTesterConfig.formats[0].lineKey.tokenPosition,'4');
  assert.equal(effectiveConfig.linelist.lineKeyTokenPositions,'4');
  assert.equal(effectiveConfig.linelist.branchNameRegex,'');
  assert.equal(deriveLineKeyFromBranchName(BRANCH,effectiveConfig),'P4110001');
  assert.equal(_derivePipingClassFromBranchName(BRANCH,effectiveConfig),'93833');
});
