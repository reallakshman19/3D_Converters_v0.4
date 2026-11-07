/**
 * Exact-input reuse restricted to ONE synchronous Step 4 Preview build.
 * No global cache: a subsequent build always re-evaluates changed masters,
 * ratings, overrides and evidence.
 */
import { buildPipingClassIndex } from '../../../converters/xml-cii2019-core/piping-class-resolver.js';
import { rankXmlCiiWeightCandidates } from '../../../converters/xml-cii2019-core/weight-valve-hints.js';

function primitiveSignature(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const parts = [];
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      // No hidden, accessor-backed, or inherited field can be trusted as
      // identical across calls: fail open to a fresh ranking calculation.
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
      const item = descriptor.value;
      const kind = item === null ? 'null' : typeof item;
      if (!['null', 'undefined', 'string', 'boolean', 'number'].includes(kind)) return null;
      const exact = kind === 'number'
        ? (Object.is(item, -0) ? '-0' : Number.isNaN(item) ? 'NaN'
          : item === Infinity ? '+Infinity' : item === -Infinity ? '-Infinity' : String(item))
        : kind === 'null' || kind === 'undefined' ? '' : item;
      parts.push([key, kind, exact]);
    }
    return JSON.stringify(parts);
  } catch {
    return null;
  }
}

/**
 * Return an exact-content signature only for ordinary data records.
 * JSON.stringify invokes toJSON before its replacer: a custom serializer
 * can hide changes to fields that the ranking engine actually reads.
 * Reject it, accessors and invisible properties; recompute instead.
 */
function dataSignature(value) {
  if (!value || typeof value !== 'object') return null;
  const seen = new WeakSet();
  let first = true;
  try {
    // JSON.stringify calls the root serializer before the replacer.
    if (typeof value.toJSON === 'function') return null;
    return JSON.stringify(value, function exactDataSignature(key, item) {
      if (first) {
        first = false;
      } else {
        // Check the original descriptor: JSON.stringify invokes getters and
        // nested toJSON methods before passing their substituted values here.
        const descriptor = Object.getOwnPropertyDescriptor(this, key);
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          throw new Error('computed/invisible data');
        }
        const original = descriptor.value;
        if (original && typeof original === 'object'
          && typeof original.toJSON === 'function') throw new Error('custom serializer');
      }
      if (item && typeof item === 'object') {
        if (seen.has(item)) throw new Error('shared/cyclic data');
        seen.add(item);
        const isArray = Array.isArray(item);
        if (!isArray && Object.getPrototypeOf(item) !== Object.prototype
          && Object.getPrototypeOf(item) !== null) throw new Error('non-plain data');
        if (typeof item.toJSON === 'function') throw new Error('custom serializer');
        // Check shape once per object, not one JS descriptor call per field:
        // the replacer already performs descriptor checks for each value.
        const visible = Object.keys(item);
        const all = Reflect.ownKeys(item);
        if (all.length !== visible.length + (isArray ? 1 : 0)) {
          throw new Error('symbol/non-enumerable data');
        }
        if (isArray) {
          if (visible.length !== item.length) throw new Error('sparse/extra array data');
          for (let index = 0; index < visible.length; index++) {
            if (visible[index] !== String(index)) throw new Error('non-index array key');
          }
        }
      } else if (['undefined', 'function', 'symbol', 'bigint'].includes(typeof item)
        || (typeof item === 'number' && !Number.isFinite(item))) {
        throw new Error('unsupported data');
      }
      return item;
    });
  } catch {
    return null;
  }
}

export function createPreviewPerBuildCache() {
  const classByMasterRows = new WeakMap();
  const rankingsByConfig = new WeakMap();
  const stats = { classBuilds: 0, classHits: 0, classInvalidations: 0,
    rankComputes: 0, rankHits: 0, rankInvalidations: 0, rankClones: 0,
    rankSignatureChecks: 0 };

  function getPipingClassIndex(masterRows) {
    if (!Array.isArray(masterRows)) {
      stats.classBuilds += 1;
      return buildPipingClassIndex(masterRows || []);
    }
    const signature = dataSignature(masterRows);
    const cached = classByMasterRows.get(masterRows);
    if (cached && signature !== null && signature === cached.signature) {
      stats.classHits += 1;
      return cached.index;
    }
    if (cached) stats.classInvalidations += 1;
    const index = buildPipingClassIndex(masterRows);
    stats.classBuilds += 1;
    if (signature !== null) classByMasterRows.set(masterRows, { signature, index });
    else classByMasterRows.delete(masterRows);
    return index;
  }

  function rankWeight(context, config, options = {}) {
    const canReuse = config && typeof config === 'object' && !Array.isArray(config)
      && typeof structuredClone === 'function';
    const contextSignature = canReuse ? primitiveSignature(context) : null;
    const optionsSignature = canReuse ? primitiveSignature(options) : null;
    if (contextSignature === null || optionsSignature === null) {
      stats.rankComputes += 1;
      return rankXmlCiiWeightCandidates(context, config, options);
    }
    const signature = JSON.stringify([contextSignature, optionsSignature]);
    let group = rankingsByConfig.get(config);
    if (group?.entries.has(signature)) {
      stats.rankSignatureChecks += 1;
      const currentWeight = dataSignature(config.weight);
      if (currentWeight !== null && currentWeight === group.weightSignature) {
        try {
          const result = structuredClone(group.entries.get(signature));
          stats.rankClones += 1;
          stats.rankHits += 1;
          return result;
        } catch {
          // Recompute rather than exposing a mutable cached result.
        }
      } else {
        stats.rankInvalidations += 1;
        rankingsByConfig.delete(config);
        group = null;
      }
    }
    stats.rankComputes += 1;
    const result = rankXmlCiiWeightCandidates(context, config, options);
    // The ranker normalizes defaults in-place; capture the signature after
    // calculation, and only once per config until a potential cache hit.
    if (!group) {
      stats.rankSignatureChecks += 1;
      const weightSignature = dataSignature(config.weight);
      if (weightSignature !== null) {
        group = { weightSignature, entries: new Map() };
        rankingsByConfig.set(config, group);
      }
    }
    if (group) {
      try {
        group.entries.set(signature, structuredClone(result));
        stats.rankClones += 1;
      } catch {
        // Future noncloneable ranking outputs are not memoized.
      }
    }
    return result;
  }

  return { getPipingClassIndex, rankWeight, stats };
}
