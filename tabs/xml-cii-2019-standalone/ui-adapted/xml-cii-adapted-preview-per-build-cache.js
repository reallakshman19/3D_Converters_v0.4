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
  for (const [key, item] of Object.entries(value)) {
    const kind = item === null ? 'null' : typeof item;
    if (!['null', 'undefined', 'string', 'boolean', 'number'].includes(kind)) return null;
    const exact = kind === 'number'
      ? (Object.is(item, -0) ? '-0' : Number.isNaN(item) ? 'NaN'
        : item === Infinity ? '+Infinity' : item === -Infinity ? '-Infinity' : String(item))
      : kind === 'null' || kind === 'undefined' ? '' : item;
    parts.push([key, kind, exact]);
  }
  return JSON.stringify(parts);
}

/**
 * Cache reuse requires unchanged JSON-like master content, not object identity
 * alone. Exotic graphs fail open to recalculation instead of guessing.
 */
function dataSignature(value) {
  if (!value || typeof value !== 'object') return null;
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, (_key, item) => {
      if (item && typeof item === 'object') {
        if (seen.has(item)) throw new Error('shared/cyclic data');
        seen.add(item);
        if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype
          && Object.getPrototypeOf(item) !== null) throw new Error('non-plain data');
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
    rankComputes: 0, rankHits: 0, rankInvalidations: 0, rankClones: 0 };

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
    let byInput = rankingsByConfig.get(config);
    if (byInput?.has(signature)) {
      const entry = byInput.get(signature);
      const currentWeight = dataSignature(config.weight);
      if (currentWeight !== null && currentWeight === entry.weightSignature) {
        try {
          const result = structuredClone(entry.snapshot);
          stats.rankClones += 1;
          stats.rankHits += 1;
          return result;
        } catch {
          // Cannot clone safely: re-evaluate instead of sharing mutable objects.
        }
      } else {
        stats.rankInvalidations += 1;
        byInput.delete(signature);
      }
    }
    stats.rankComputes += 1;
    const result = rankXmlCiiWeightCandidates(context, config, options);
    // Ranking normalizes default weight settings in-place. Fingerprint only
    // AFTER calculation, so the saved signature describes the evaluated input.
    const weightSignature = dataSignature(config.weight);
    if (weightSignature !== null) {
      try {
        const snapshot = structuredClone(result);
        stats.rankClones += 1;
        if (!byInput) {
          byInput = new Map();
          rankingsByConfig.set(config, byInput);
        }
        byInput.set(signature, { snapshot, weightSignature });
      } catch {
        // Unsupported result values fail open to recalculation.
      }
    }
    return result;
  }

  return { getPipingClassIndex, rankWeight, stats };
}
