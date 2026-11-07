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

## Unknown component physical-length suggestion (review only)

For an **unknown or unresolved physical component**, the user-defined 6 mm
selector chooses a reference master family at the **same bore DN and pressure
rating**:

1. Resolve the **Weldneck Flange** reference length and weight (exact master
   DN or two-sided nearest DN bracketing).
2. If physical component length is strictly **less** than flange reference
   length + **6 mm**, select the **Weldneck Flange** reference.
3. If strictly **greater**, select the **Flanged Ball Valve-Reduced Bore**
   reference at the same bore DN/rating.
4. Exact equality is `LENGTH_AT_DECISION_BOUNDARY` / **HOLD** (neither
   strict rule applies). Missing same-class reference anchors are also HOLD.

When no exact requested DN master row exists, the engine linearly interpolates
**reference length and reference weight separately** between the nearest
smaller/larger DN rows of that selected family and rating. It never borrows
another family, target or rating, or uses one-sided extrapolation.

The suggested weight then uses a **length-proportional heuristic**:

```text
suggestedKg = selectedReferenceKg * physicalComponentLengthMm
                                    / selectedReferenceLengthMm
```

The DN interpolation is a genuine two-anchor interpolation; length-proportional
scaling is a heuristic, not a validated component-mass model, and may be
one-sided extrapolation beyond the reference length. Both calculations and
their original anchors are disclosed.

```js
import { suggestUnknownComponentLengthWeight } from './converters/empirical-weight/index.js';
const result = suggestUnknownComponentLengthWeight({
  componentLengthMm: 19.1, boreMm: 50, rating: 900, target: 'RF/RTJ KG',
});
// built-in reference flange: 109 mm, 15 kg; 109+6=115 mm.
// advisory suggestedKg: 2.628 kg, not 15 kg.
// For 371.2 mm, reduced-bore ball valve: 368 mm / 47 kg,
// advisory suggestedKg: 47.409 kg.
```

The Empirical Weight Tuning **Sandbox** has separate unknown-component
length/bore/rating inputs and shows the selected reference and anchors.
Unresolved Weight Match rows with a physical same-component endpoint span
or explicit `ElementLengthMm` show a **non-clickable advisory** in addition
to their existing candidate list. Computed-forward CII gap/route lengths are
not trusted as physical component lengths for these suggestions.

**No release authority:** An unknown component's source mass and whether a
connection has physical pipe, gasket or empty-gap material are not established
by the reference family selected. A `PCOM` must never be reclassified as a
flange or valve. Suggestions do not write `Weight`, CII `RIGID`, overrides,
or bulk preferred candidates; the existing Native Final mass-conservation
and PR #5/#6 safety controls remain independent. The 19.1 mm CII connection
length may differ from its actual 12.7 mm PCOM physical span: use the **real
component length**, not the CII element length, when requesting a suggestion.

## Extrapolation

The default production call does not extrapolate outside the validated Approach 1 size range. A caller must opt in:

```js
const result = estimator.estimate(request, { allowExtrapolation: true });
```

Such output is labeled `EXTRAPOLATED` with `LOW` confidence.

## Model ownership

`converters/empirical-weight/empirical-weight-model.js` exposes all 270 Approach 1 equations (assembled from `converters/empirical-weight/model/part-*.js`) and the Approach 2 family stack weights. Regenerate the model registry whenever `wtValveweights` is materially changed; do not hand-edit individual coefficients.
