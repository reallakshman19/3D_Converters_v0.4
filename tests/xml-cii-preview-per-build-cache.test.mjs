import assert from 'node:assert/strict';
import test from 'node:test';
import { createPreviewPerBuildCache } from '../tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-preview-per-build-cache.js';
import { rankXmlCiiWeightCandidates } from '../converters/xml-cii2019-core/weight-valve-hints.js';

function masterRows() {
  return [
    { bore: 50, rating: 150, length: 100, valveType: 'GATE VALVE', weight: 10, Type: 'GV', DN: 50, Rating: 150 },
    { bore: 50, rating: 150, length: 120, valveType: 'GATE VALVE', weight: 12, Type: 'GV', DN: 50, Rating: 150 },
  ];
}
const context = {
  boreMm: 50, rating: 150, lengthMm: 100, nodeName: 'GATE VALVE',
  componentType: 'VALV', componentRefNo: '=G1', dtxr: 'GATE VALVE',
};

test('one Preview build memoizes only structurally identical ranking inputs and config', () => {
  const config = { weight: { masterRows: masterRows() } };
  const cache = createPreviewPerBuildCache();
  const first = cache.rankWeight(context, config, { includeRejected: true });
  assert.deepStrictEqual(first, rankXmlCiiWeightCandidates(context, config, { includeRejected: true }));
  const again = cache.rankWeight({ ...context }, config, { includeRejected: true });
  assert.deepStrictEqual(first, again);
  assert.notStrictEqual(first, again, 'ranking object identity must not leak between nodes');
  assert.equal(cache.stats.rankHits, 1);
  assert.equal(cache.stats.rankComputes, 1);

  cache.rankWeight({ ...context, nodeName: 'CHECK VALVE' }, config, { includeRejected: true });
  cache.rankWeight({ ...context, dtxr: 'UNKNOWN COMPONENT' }, config, { includeRejected: true });
  cache.rankWeight(context, config, { includeRejected: false });
  cache.rankWeight(context, { ...config }, { includeRejected: true });
  assert.equal(cache.stats.rankHits, 1);
  assert.equal(cache.stats.rankComputes, 5);
});

test('cached ranking snapshots are independent of the first caller mutable result', () => {
  const config = { weight: { masterRows: masterRows() } };
  const cache = createPreviewPerBuildCache();
  const first = cache.rankWeight(context, config, { includeRejected: true });
  const expected = structuredClone(first);
  first.candidates.push({ invented: true });
  const second = cache.rankWeight(context, config, { includeRejected: true });
  assert.deepStrictEqual(second, expected);
  assert.equal(cache.stats.rankHits, 1);
});

test('class index is shared only for identical master-row array identity per build', () => {
  const cache = createPreviewPerBuildCache();
  const rows = [{ 'Piping Class': '93833', DN: 50, Rating: 900 }];
  const first = cache.getPipingClassIndex(rows);
  const second = cache.getPipingClassIndex(rows);
  const third = cache.getPipingClassIndex(rows.map((row) => ({ ...row })));
  assert.strictEqual(first, second);
  assert.notStrictEqual(first, third);
  assert.deepStrictEqual(
    { classBuilds: cache.stats.classBuilds, classHits: cache.stats.classHits },
    { classBuilds: 2, classHits: 1 },
  );
});

test('a new Preview invocation does not reuse stale rankings or mutated master indices', () => {
  const rows = masterRows();
  const config = { weight: { masterRows: rows } };
  const firstBuild = createPreviewPerBuildCache();
  firstBuild.rankWeight(context, config, { includeRejected: true });
  rows[0].weight = 22;
  const newBuild = createPreviewPerBuildCache();
  const fresh = newBuild.rankWeight(context, config, { includeRejected: true });
  assert.deepStrictEqual(fresh, rankXmlCiiWeightCandidates(context, config, { includeRejected: true }));
  assert.equal(newBuild.stats.rankHits, 0);
  assert.equal(newBuild.stats.rankComputes, 1);
});

test('same-object weight master edit invalidates cached ranking within the same build', () => {
  const rows = masterRows();
  const config = { weight: { masterRows: rows } };
  const cache = createPreviewPerBuildCache();
  const original = cache.rankWeight(context, config, { includeRejected: true });
  rows[0].weight = 20;
  const changed = cache.rankWeight(context, config, { includeRejected: true });
  const fresh = rankXmlCiiWeightCandidates(context, config, { includeRejected: true });
  assert.deepStrictEqual(changed, fresh);
  assert.notDeepStrictEqual(changed, original, 'stale weight must not be returned');
  assert.equal(cache.stats.rankInvalidations, 1);
  assert.equal(cache.stats.rankHits, 0);
  assert.equal(cache.stats.rankComputes, 2);
});

test('same-object class row edits invalidate index without replacing master array', () => {
  const rows = [{ 'Piping Class': '93833', DN: 50, Rating: 900 }];
  const cache = createPreviewPerBuildCache();
  const original = cache.getPipingClassIndex(rows);
  rows[0]['Piping Class'] = '93834';
  const updated = cache.getPipingClassIndex(rows);
  assert.notStrictEqual(updated, original);
  assert.deepStrictEqual([...updated.keys()], ['93834']);
  assert.equal(cache.stats.classInvalidations, 1);
  assert.equal(cache.stats.classBuilds, 2);
  assert.equal(cache.stats.classHits, 0);
});

test('same-object settings change and unsupported master values fail open', () => {
  const rows = masterRows();
  const config = { weight: { masterRows: rows } };
  const cache = createPreviewPerBuildCache();
  cache.rankWeight(context, config, { includeRejected: true });
  config.weight.valveHintLengthToleranceMm = 0;
  const changed = cache.rankWeight(context, config, { includeRejected: true });
  assert.deepStrictEqual(changed, rankXmlCiiWeightCandidates(context, config, { includeRejected: true }));
  assert.equal(cache.stats.rankInvalidations, 1);
  config.weight.nonSerializable = () => 1;
  cache.rankWeight(context, config, { includeRejected: true });
  cache.rankWeight(context, config, { includeRejected: true });
  assert.equal(cache.stats.rankHits, 0);
  const classRows = [{ 'Piping Class': '93833', DN: 50, debugFn: () => 1 }];
  const classCache = createPreviewPerBuildCache();
  classCache.getPipingClassIndex(classRows);
  classCache.getPipingClassIndex(classRows);
  assert.equal(classCache.stats.classHits, 0);
  assert.equal(classCache.stats.classBuilds, 2);
});

test('different ranking contexts do not rescan master content just to miss', () => {
  const config = { weight: { masterRows: masterRows() } };
  const cache = createPreviewPerBuildCache();
  for (let index = 0; index < 12; index += 1) {
    cache.rankWeight({ ...context, nodeName: 'VALVE-' + index }, config, { includeRejected: true });
  }
  assert.equal(cache.stats.rankHits, 0);
  assert.equal(cache.stats.rankComputes, 12);
  assert.equal(cache.stats.rankSignatureChecks, 1, 'content check needed for hits, not distinct contexts');
});

test('master changes during a different ranking miss cannot revive older result', () => {
  const rows = masterRows();
  const config = { weight: { masterRows: rows } };
  const cache = createPreviewPerBuildCache();
  const before = cache.rankWeight(context, config, { includeRejected: true });
  rows[0].weight = 33;
  cache.rankWeight({ ...context, componentRefNo: '=DIFFERENT' }, config, { includeRejected: true });
  const after = cache.rankWeight(context, config, { includeRejected: true });
  assert.notDeepStrictEqual(after, before);
  assert.deepStrictEqual(after, rankXmlCiiWeightCandidates(context, config, { includeRejected: true }));
  assert.equal(cache.stats.rankInvalidations, 1);
});

test('toJSON cannot hide a changed master weight from the cache signature', () => {
  const config = { weight: { masterRows: masterRows() } };
  // The config is not included in ranking outputs. Unlike a master-row
  // serializer, this leaves cached results cloneable on the old candidate.
  config.weight.toJSON = () => ({ fixed: 'misleading signature' });
  const cache = createPreviewPerBuildCache();
  const initial = cache.rankWeight(context, config, { includeRejected: true });
  config.weight.masterRows[0].weight = 23;
  const changed = cache.rankWeight(context, config, { includeRejected: true });
  assert.notDeepStrictEqual(changed, initial);
  assert.deepStrictEqual(
    changed, rankXmlCiiWeightCandidates(context, config, { includeRejected: true }),
  );
  assert.equal(cache.stats.rankHits, 0);
});

test('non-enumerable ranking inputs fail open rather than reusing stale results', () => {
  const row = masterRows()[0];
  Object.defineProperty(row, 'weight', {
    value: 10, enumerable: false, writable: true, configurable: true,
  });
  const config = { weight: { masterRows: [row] } };
  const cache = createPreviewPerBuildCache();
  const initial = cache.rankWeight(context, config, { includeRejected: true });
  row.weight = 29;
  const changed = cache.rankWeight(context, config, { includeRejected: true });
  assert.notDeepStrictEqual(changed, initial);
  assert.deepStrictEqual(
    changed, rankXmlCiiWeightCandidates(context, config, { includeRejected: true }),
  );
  assert.equal(cache.stats.rankHits, 0);
});

test('hidden or accessor-backed context fields fail open to fresh rankings', () => {
  const config = { weight: { masterRows: masterRows() } };
  const hidden = { ...context };
  Object.defineProperty(hidden, 'boreMm', {
    value: 50, enumerable: false, writable: true, configurable: true,
  });
  const hiddenCache = createPreviewPerBuildCache();
  const before = hiddenCache.rankWeight(hidden, config, { includeRejected: true });
  hidden.boreMm = 80;
  const after = hiddenCache.rankWeight(hidden, config, { includeRejected: true });
  assert.notDeepStrictEqual(after, before);
  assert.deepStrictEqual(
    after, rankXmlCiiWeightCandidates(hidden, config, { includeRejected: true }),
  );
  assert.equal(hiddenCache.stats.rankHits, 0);

  let bore = 50;
  const computed = { ...context };
  Object.defineProperty(computed, 'boreMm', {
    enumerable: true, configurable: true, get() { return bore; },
  });
  const getterCache = createPreviewPerBuildCache();
  const first = getterCache.rankWeight(computed, config, { includeRejected: true });
  bore = 80;
  const second = getterCache.rankWeight(computed, config, { includeRejected: true });
  assert.notDeepStrictEqual(second, first);
  assert.deepStrictEqual(
    second, rankXmlCiiWeightCandidates(computed, config, { includeRejected: true }),
  );
  assert.equal(getterCache.stats.rankHits, 0);
});
