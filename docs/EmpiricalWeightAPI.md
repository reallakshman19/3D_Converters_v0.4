# Empirical Weight API

Reusable ES-module API for the two empirical weight methods documented in `docs/EmpericalWeightconceptNote.md`.

## Public import

```js
import {
  estimateEmpiricalWeight,
  createEmpiricalWeightEstimator,
  estimateEmpiricalWeightApproach1,
  estimateEmpiricalWeightApproach2,
} from '../converters/empirical-weight/index.js';
```

## Default production call

```js
const result = estimateEmpiricalWeight({
  typeDesc: 'Flanged Gate Valve',
  ns: 10,
  rating: 900,
  target: 'BW',
});

if (result.ok) {
  console.log(result.weightKg, result.approach, result.confidence);
}
```

Production routing is: exact master cell → Approach 2 matrix stack → Approach 1 size-band equation → optional low-confidence extrapolation.

## Uploaded/custom master rows

Modules that already own a weight-master context should create one cached estimator instead of rebuilding the catalog on each call:

```js
const estimator = createEmpiricalWeightEstimator({
  masterRows: masterContext.weightMasterRows,
});

const result = estimator.estimate({
  typeDesc: row.TypeDesc,
  ns: row.NS,
  dn: row.DN,
  rating: row.Rating,
  target: 'RF/RTJ KG',
});
```

## Direct method selection

```js
const a1 = estimator.approach1(request);  // size-band equation only
const a2 = estimator.approach2(request);  // matrix-assisted stack only
const exact = estimator.exact(request);   // exact master lookup only
```

The top-level convenience exports provide the same direct calls against the built-in default master.

## Request fields

- `typeDesc` / `TypeDesc`: canonical family name; matching is case-insensitive.
- `ns` / `NS`: nominal pipe size used by the fitted equations.
- `dn` / `DN`: accepted when it maps to a known NS in the supplied master.
- `rating` / `Rating`: positive pressure rating/class.
- `target`: `RF`, `RTJ`, `RF/RTJ KG`, `BW`, or `BW KG`.
- `endType`: can be used instead of target; values containing `BW` select `BW KG`.

## Result fields

Successful results include:

```js
{
  ok: true,
  weightKg,
  target,
  approach,      // EXACT | A2_MATRIX | A1_SIZE_BAND | EXTRAPOLATED
  confidence,    // EXACT | HIGH | MEDIUM | EQUATION | LOW
  modelId,
  typeDesc,
  size,
  rating
}
```

Approach 2 additionally returns `predictions` (`band`, `ratio`, `cross`), configured weights, renormalized active weights, and matrix-support diagnostics. Approach 1 additionally returns model form, coefficients, band cuts, and validated size range.

## Nearest master-cell interpolation (explicit preview / opt-in)

When an exact cell is absent, the estimator can find the **closest lower and upper
nominal sizes** within the **same canonical component family, pressure rating and
weight target** in the existing master. It interpolates mass in kg *linearly in
nominal size (NS)*:

```text
estimatedKg = lowerKg + (requestedNS - lowerNS)
                         / (upperNS - lowerNS) * (upperKg - lowerKg)
```

No single-neighbour extrapolation, rating borrowing, different weight target,
or different physical component type is permitted. Missing one of the two
bracketing sizes returns `NEAREST_BRACKET_UNAVAILABLE`. Duplicate master
cells retain the existing median-cell rule. No guessed pipe or PCOM mass is
manufactured.

```js
const estimate = estimator.nearestInterpolation({
  typeDesc: 'SPECTACLE BLIND', rating: 300, ns: 5, target: 'RF/RTJ KG',
});
// Built-in master: 4-inch = 4 kg, 6-inch = 9 kg -> 5-inch = 6.5 kg.
// approach: NEAREST_INTERPOLATED, confidence: INTERPOLATED
// interpolation.lower/upper and .fraction record the source cells.

const nearestFirst = estimator.estimate(request, { allowNearestInterpolation: true });
```

In **Empirical Weight Tuning → Sandbox**, type a custom `Estimate NS` to
compare the new `Nearest master bracket` row with the unchanged production
`Final API estimate`. The `Final API · nearest-first (review only)` row
shows the opt-in route without publishing it.

**Release authority:** interpolation is `ESTIMATE_ONLY_NOT_APPROVED_COMPONENT_MASS`.
It is *not* an approved physical component mass and must not bypass any
XML→CII rigid-weight ownership, native writer or independent mass-conservation
gate. Default production routing remains
exact → A2 matrix → A1 equation (unchanged). This feature must be qualified
before opt-in routing is promoted for production.

## Extrapolation

The default production call does not extrapolate outside the validated Approach 1 size range. A caller must opt in:

```js
const result = estimator.estimate(request, { allowExtrapolation: true });
```

Such output is labeled `EXTRAPOLATED` with `LOW` confidence.

## Model ownership

`converters/empirical-weight/empirical-weight-model.js` exposes all 270 Approach 1 equations (assembled from `converters/empirical-weight/model/part-*.js`) and the Approach 2 family stack weights. Regenerate the model registry whenever `wtValveweights` is materially changed; do not hand-edit individual coefficients.
