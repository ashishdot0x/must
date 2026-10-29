# Engineering Handoff Directive

## Objective

Correct the GPS billing path so that valid distance inside the campaign zone is reported by driver and fixed UTC+9 local date. The outcome must be reproducible, observable, and checked against both diagnostic evidence and regression tests.

## Scope

Included:

- Chronological processing by GPS timestamp.
- Canonical duplicate handling.
- Input, road-distance, and speed validation.
- Proposed trip-gap exclusion.
- Polygon segment clipping and UTC+9 midnight allocation.
- Complete expected/naive/fixed summary-key coverage.
- Regression tests and independent analytical fixtures.

Explicitly excluded:

- Changes to the intentionally incorrect [src/naiveCalc.js](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/src/naiveCalc.js).
- Changes to the synthetic dataset or [data/expected.csv](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/data/expected.csv).
- Monetary loss calculations; no billing rate was supplied.
- Final repository publication, commit creation, and video recording.

## Requirements

The supplied assessment rules are:

1. Ignore GPS pings more than 100 metres from the road.
2. Ignore GPS pings implying speeds above 150 km/h.
3. Count a driver/timestamp duplicate once.
4. Process late and out-of-order pings by GPS timestamp.
5. Use fixed UTC+9 reporting dates for UTC timestamps.
6. Bill only distance inside the campaign polygon, including partial boundary-crossing segments.

Implementation assumptions requiring review:

- A gap greater than five minutes separates implicit trips.
- When speed evidence is ambiguous, neighboring road/speed evidence and a deterministic endpoint policy are used.
- The first deterministically ordered record is retained for conflicting duplicate coordinates; the conflict is exposed in diagnostics.
- Rejected observations do not permanently split the route; retained neighbors may reconnect.
- Boundary points and positive-length boundary travel are billable; polygon holes are not billable except for qualifying boundary travel under the proposed policy.
- Midnight distance is apportioned by elapsed-time proportion.

## Implementation approach

1. **Chronological sorting:** validate UTC timestamps and sort copies of each driver's records by epoch milliseconds and source order.
2. **Duplicate handling:** use driver ID plus parsed epoch milliseconds as the identity. Preserve conflict diagnostics.
3. **Road filtering:** reject coordinates more than 100 metres from the road, with a small floating-point tolerance at the inclusive boundary.
4. **Speed filtering:** evaluate chronological implied speed, remove the selected outlier, and recompute adjacent evidence.
5. **Trip gaps:** exclude edges over the proposed five-minute threshold and do not use them for speed or billing continuity.
6. **Zone clipping:** intersect segment geometry with all polygon rings, excluding hole interiors and applying the documented boundary policy.
7. **UTC+9 allocation:** split qualifying distance at fixed UTC+9 local midnights using elapsed-time proportions.

## Completion criteria

- The deterministic dataset contains 3,630 input records, five drivers, and three UTC+9 reporting dates.
- `npm run check` processes the complete input and emits diagnostic flags and a complete billing summary.
- The summary contains all 15 expected driver/date combinations.
- The report-rounded fixed absolute error is lower than the naive absolute error and each nonzero expected row is within 1%.
- The regression suite executes with 38 total tests: 32 ordinary passes and six expected naive failures, with no unexpected failures or skipped tests.
- Evidence files are present: flags, summary, naive comparison, map, and JSON test results.
- Known policy and model-independence limitations are documented.

## Before/after results

The following table is transcribed from [reports/summary.csv](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/reports/summary.csv). Distances are rounded to six decimal places by the report.

| Driver | Local date | Expected km | Naive km | Fixed km | Naive error % | Fixed error % |
|---|---|---:|---:|---:|---:|---:|
| driver_1 | 2026-01-01 | 10.960837 | 25.765742 | 10.960854 | 135.07% | 0.00% |
| driver_1 | 2026-01-02 | 10.887759 | 20.494281 | 10.887758 | 88.23% | -0.00% |
| driver_1 | 2026-01-03 | 3.209477 | 0.000000 | 3.209474 | -100.00% | -0.00% |
| driver_2 | 2026-01-01 | 16.001643 | 30.821544 | 16.001675 | 92.61% | 0.00% |
| driver_2 | 2026-01-02 | 13.513326 | 22.244030 | 13.513260 | 64.61% | -0.00% |
| driver_2 | 2026-01-03 | 3.051181 | 0.000000 | 3.051172 | -100.00% | -0.00% |
| driver_3 | 2026-01-01 | 21.086515 | 35.843547 | 21.086498 | 69.98% | -0.00% |
| driver_3 | 2026-01-02 | 13.902136 | 20.785332 | 13.902138 | 49.51% | 0.00% |
| driver_3 | 2026-01-03 | 0.621889 | 0.000000 | 0.621882 | -100.00% | -0.00% |
| driver_4 | 2026-01-01 | 24.267354 | 36.910707 | 24.267360 | 52.10% | 0.00% |
| driver_4 | 2026-01-02 | 10.196074 | 16.936640 | 10.196069 | 66.11% | -0.00% |
| driver_4 | 2026-01-03 | 0.000000 | 0.000000 | 0.000000 | 0.00% | 0.00% |
| driver_5 | 2026-01-01 | 21.803458 | 31.681438 | 21.803452 | 45.30% | -0.00% |
| driver_5 | 2026-01-02 | 7.574206 | 13.978226 | 7.574186 | 84.55% | -0.00% |
| driver_5 | 2026-01-03 | 0.000000 | 0.000000 | 0.000000 | 0.00% | 0.00% |

Using the six-decimal values in the report:

- Naive total absolute difference: **112.150726 km**.
- Naive total signed difference: **+98.385632 km**.
- Fixed total absolute difference: **0.000191 km**.
- Fixed total signed difference: **-0.000077 km**.
- Maximum fixed percentage error calculated from report-rounded values: **0.001125603%**.

The higher-precision direct calculation recorded in [QA_LOG.md](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/QA_LOG.md) is 112.150725384 km naive absolute error, 0.000188524 km fixed absolute error, and 0.001070514% maximum fixed percentage error. The small difference is report rounding, not a dataset change. These are distance discrepancies, not monetary losses.

## Regression evidence

[reports/test_results.json](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/reports/test_results.json) records 38 total tests, 38 Vitest-passed assertions, zero failed, zero pending, and zero todo. The terminal run distinguishes this as 32 ordinary passes plus six expected naive failures. The six naive cases use `it.fails` because they intentionally demonstrate the known defects in the reference calculator; they are not six ordinary fixed-calculator failures.

## How to reproduce

From the project root:

```powershell
npm install
node src/gen.js --seed 42
npm run check
npm run check:map
npm test
npm run test:report
```

`node src/gen.js --seed 42` regenerates deterministic synthetic data and expected output, so it should not be run when preserving the current evidence files. The commands are compatible with the existing package scripts. Results are written to `reports/`; open `reports/map.html` in a browser for the diagnostic map. The map uses CDN-hosted map tiles when available.

## Still not solved

- The five-minute trip-gap threshold is proposed and needs business approval.
- Speed endpoint selection can be ambiguous for adjacent or overlapping outliers.
- Reconnecting retained observations after filtering is an implementation assumption.
- General self-intersecting, non-finite, or otherwise malformed polygon topology is not fully validated.
- Boundary and hole-boundary policy is proposed rather than confirmed business policy.
- Full generated expected values remain partly dependent on shared Turf/model assumptions; hand-built independent oracles cover selected analytical cases.
- There is no billing rate, so distance differences cannot be converted into currency.
- Human review and video recording are not complete.

## Handoff appendix

- [REPO] TODO — no repository URL supplied.
- [DATASET] `data/pings.csv` and `data/expected.csv` in this workspace.
- [QA TOOL] `check.js` and the `check` / `check:map` npm scripts.
- [FIX COMMIT] Pending — no Git history or commit hash is available in the current workspace.
- [TEST RESULTS] `reports/test_results.json`.
