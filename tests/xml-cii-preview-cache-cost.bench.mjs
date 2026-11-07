import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createPreviewPerBuildCache } from '../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-preview-per-build-cache.js';
import { rankXmlCiiWeightCandidates } from '../converters/xml-cii2019-core/weight-valve-hints.js';
import { buildPipingClassIndex } from '../converters/xml-cii2019-core/piping-class-resolver.js';

// Only a synthetic operation benchmark. It does not simulate Owner GLRD config.
const weightRows = Array.from({length:1600},(_,i)=>({
  bore:i%3===0?50:100,rating:i%2?900:150,length:80+(i%40),
  valveType:i%5?'GATE VALVE':'CHECK VALVE',weight:8+i/8,
  Type:i%5?'GV':'CV',DN:i%3===0?50:100,Rating:i%2?900:150
}));
const classRows = Array.from({length:10500},(_,i)=>({
  'Piping Class':String(93000+i%120),DN:i%3===0?50:100,
  Rating:i%2?900:150,'Wall thickness':5+i%7,
  Schedule:i%2?'80':'40',componentType:'PIPE'
}));
const context={boreMm:50,rating:900,lengthMm:100,nodeName:'GATE VALVE',
  componentType:'VALV',componentRefNo:'=B-001',dtxr:'GATE VALVE'};
const config={weight:{masterRows:weightRows}};
const iterations=12;
function time(fn){const start=performance.now();const result=fn();return {ms:performance.now()-start,result}}
function weight(cacheEnabled){
  const cache=createPreviewPerBuildCache();
  const run=()=>Array.from({length:iterations},()=>{
    const r=cacheEnabled?cache.rankWeight(context,config,{includeRejected:true}):
      rankXmlCiiWeightCandidates(context,config,{includeRejected:true});
    return [r.best?.weight??null,r.candidates.length,r.rejectedCandidates.length];
  });
  return {...time(run),hits:cache.stats.rankHits};
}
function piping(cacheEnabled){
  const cache=createPreviewPerBuildCache();
  const run=()=>Array.from({length:iterations},()=>{
    const idx=cacheEnabled?cache.getPipingClassIndex(classRows):buildPipingClassIndex(classRows);
    return idx.size;
  });
  return {...time(run),hits:cache.stats.classHits};
}
// Warm caches and JIT before measuring. Same benchmark parameters across heads.
for(const fn of [()=>weight(false),()=>weight(true),()=>piping(false),()=>piping(true)])fn();
const rounds=[];
for(let i=0;i<3;i++){
  const wb=weight(false),wa=weight(true),cb=piping(false),ca=piping(true);
  assert.deepStrictEqual(wa.result,wb.result,'weight summary drift');
  assert.deepStrictEqual(ca.result,cb.result,'class index size drift');
  rounds.push({round:i+1,weightNoCacheMs:+wb.ms.toFixed(1),
    weightCacheMs:+wa.ms.toFixed(1),weightCacheHits:wa.hits,
    classNoCacheMs:+cb.ms.toFixed(1),classCacheMs:+ca.ms.toFixed(1),
    classCacheHits:ca.hits});
}
console.log(JSON.stringify({scope:'SYNTHETIC_OPERATION_ONLY_NOT_OWNER_PREVIEW',
  rowCounts:{weight:weightRows.length,pipingClass:classRows.length},
  iterations,rounds},null,2));
