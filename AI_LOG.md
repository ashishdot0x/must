# AI Assistance Log

## Phase

Phase 1 — environment inspection and project preparation.

## AI assistance

Inspected the workspace `package.json`, checked Node.js and npm versions, checked installed packages, installed Vitest because it was missing, created the requested directory structure, and created the Phase 1 documentation and repository hygiene files.

## Suggested approach

Keep the project as plain JavaScript ES modules with small, readable modules and JSDoc. Record interpretations as proposed assumptions until reviewed. Defer all GPS calculations, synthetic datasets, calculators, QA tooling, and regression tests to later authorized phases.

## Current documentation-update verification

- `npm.cmd test` exited `0`: 32 tests passed and 6 intentionally expected naive failures were reported across 38 tests; there were no unexpected failures or skipped tests.
- `npm.cmd run check` exited `0` after validating 3,630 input records across five drivers. Fixed diagnostics remained 0 invalid, 15 duplicates removed, 18 off-road rejected, 12 speed outliers rejected, and 10 trip-gap edges excluded.
- `git diff --check` reported no whitespace errors.
- Before this documentation update, the working tree already contained a modification to `reports/test_results.json`; that file was preserved and no report-generation command was run during this update.

## Documentation and submission consistency assistance

- Inspected `README.md`, `directive.md`, `intent.md`, `QA_LOG.md`, this log, the local walkthrough script, the configured Git remote, and the complete local Git history before editing.
- Updated documentation only: replaced local Windows Markdown paths in `directive.md` with relative links, replaced repository and commit placeholders with verified local Git metadata, and aligned submission wording across the README, directive, intent, and QA log.
- The documentation issues found were stale repository/commit placeholders, inconsistent publication/video status wording, and absolute Windows paths in Markdown links.
- Recorded the actual submission state: the GitHub repository is published at `https://github.com/ashishdot0x/must`; the inspected final snapshot is commit `cc017364c15bc45a1eb5677741623c888f05a5dd43`; no separate fix-only commit exists; the Loom video has not been recorded; and no Loom file or link was added.
- A direct `git ls-remote` network probe could not connect to GitHub in this environment. The local remote URL and matching `HEAD`/`origin/main` hashes are recorded as the available evidence; live remote access is not claimed.
- The existing technical findings and prior test evidence were preserved. No GPS logic, dataset, business rule, or test was changed by this documentation update.

## Phase 7.1 remediation assistance

Implemented remediation for the six Phase 7 findings: added strict input validation, canonical timestamp deduplication with conflict diagnostics, fixed-only billing-summary key coverage, ring-aware polygon clipping with explicit boundary handling, a standalone analytical test oracle, and corrected Phase 6 test-count documentation. The naive calculator and source dataset were preserved.

## Phase 7.1 actual verification

- `npm.cmd run test` exited `0`: 38 total tests, 32 normal passes, 6 expected naive failures, 0 unexpected failures, and 0 skipped.
- `npm.cmd run test:report` exited `0` and wrote `reports/test_results.json` with 38 total, 38 passed, 0 failed, and 0 pending under Vitest's expected-failure reporting.
- `npm.cmd run check` exited `0` over all 3,630 records.
- `npm.cmd run check:map` exited `0`.
- Fixed diagnostics remained 0 invalid, 15 duplicates removed, 18 off-road rejected, 12 speed outliers removed, and 10 trip-gap edges excluded.
- New geometry tests cover holes, boundary-aligned travel, tangential contact, vertices, multiple intersections, and malformed polygons.
- Full generated expected values remain model-dependent; the new independent oracle establishes analytical fixture correctness and midnight elapsed-ratio behavior without importing production billing helpers.

## Phase 6 implementation assistance

Created `tests/regression.test.js` with independent Turf-derived expectations for the six business rules, focused edge cases, and an end-to-end comparison against the unchanged expected CSV. Added the requested `test` and `test:report` scripts to `package.json`. The generated test report is `reports/test_results.json`.

## Phase 6 debugging and actual changes

- The first test run exposed four fixture/design errors: incorrect midnight allocation expectation, an off-road starting point in the 100 m test, an incorrect 150 km/h distance conversion, and an interval spanning four rather than three local dates.
- After fixture corrections, the exact 150 km/h test exposed floating-point overshoot (`150.00000000000006`) at an inclusive threshold.
- Added a documented `1e-9` comparison epsilon in `src/fixedCalc.js` for road-distance and speed thresholds. This was treated as a genuine boundary defect, not hidden with a relaxed test assertion.

## Phase 6 executed validation

- An intermediate `npm.cmd run test` exited `0` with 19 normal passes and 6 expected naive failures across 25 tests. The final Phase 6 suite added one explicit zone case and had 26 tests: 20 normal passes and 6 expected naive failures.
- `npm.cmd run test:report` exited `0` and wrote `reports/test_results.json`; the final Phase 6 JSON summary was 26 total, 26 passed, 0 failed, 0 pending because expected failures are represented as passing assertions by Vitest.
- `npm.cmd run check` exited `0` over all 3,630 records.
- Static problem checks reported no errors for the regression test or fixed calculator.
- Stage reconciliation found three injected speed-spike records among the 18 off-road removals and the other 12 injected speed-spike records removed at the speed stage. No clean-labeled record was identified as removed by that speed-stage analysis.
- No Phase 7 files were created.

## Phase 5 implementation assistance

Implemented only the fixed geographic helpers in `src/geo.js`, the corrected calculator in `src/fixedCalc.js`, and the Phase 4 CLI integration in `check.js`. The existing dataset, expected results, and intentionally buggy calculator were not edited. The CLI now writes fixed metrics and uses the fixed calculator's retained records for the green map path.

## Phase 5 executed validation

- Ran `npm.cmd run check`; exit code `0`.
- Ran `npm.cmd run check:map`; exit code `0`.
- Ran a direct Node comparison of `fixedDistance` against unchanged `data/expected.csv`.
- Verified 3,630 input pings, 15 fixed output rows, five drivers, and three UTC+9 dates.
- Direct comparison measured total absolute difference `0.000188524 km`, total signed difference `-0.000074914 km`, and maximum absolute percentage difference `0.001070514%`.
- Verified the fixed pipeline diagnostics: invalid `0`, duplicate removals `15`, off-road rejections `18`, speed-outlier rejections `12`, and excluded trip-gap edges `10`.
- Verified the source input array remained unchanged and an invalid timestamp/duplicate/trip-gap sample produced finite output.
- Inspected `reports/map.html` for raw red paths, fixed green paths, campaign-zone layer, flagged markers, and popups. The shared browser page showed the Leaflet legend and controls; OpenStreetMap tile requests failed in the environment.
- `problems` reported no errors in `src/geo.js`, `src/fixedCalc.js`, or `check.js`.

## Phase 5 decisions and limitations

- Used fixed UTC+9 through Luxon rather than machine timezone.
- Used a proposed 5-minute trip-gap threshold because the dataset has implicit trips and no `trip_id`.
- Used deterministic local geometry tie-breaking when a speed outlier could not be uniquely assigned to one endpoint.
- No Phase 6 tests or final submission documentation were created.

## Phase 3 implementation assistance

Implemented only `src/naiveCalc.js`, `scripts/compareNaive.js`, and the supplementary `reports/naive_comparison.csv`. The calculator intentionally preserves the requested arrival-order, duplicate, off-road, speed, UTC-date, endpoint-zone, and trip-boundary defects. The comparison script reads the unchanged Phase 2 dataset and expected results, uses the union of driver/date keys, writes the report, and checks that its input array was not mutated.

## Phase 3 executed validation

- Inspected `ASSUMPTIONS.md`, `QA_LOG.md`, `AI_LOG.md`, `src/gen.js`, the Phase 2 CSV/GeoJSON files, and `package.json`.
- Ran `node scripts/compareNaive.js` twice after the UTC parsing refinement.
- Verified five drivers, expected dates, finite numeric output, unchanged expected values, and no input mutation.
- Independently recomputed the `driver_1` / `2026-01-01` naive value: `25.765742 km`, matching the report.
- Independently measured duplicate removal delta: `0 km` for the exact-coordinate duplicates.
- Inspected 20 endpoint-crossing segments and estimated an approximate 10.696451 km endpoint-zone overcount opportunity; this was not treated as an isolated contribution to total error.

## Actual Phase 3 results

- Total absolute error: `112.150725 km`.
- Overall signed difference: `98.385631 km`.
- All 15 report rows contained finite values.
- January 3 was expected-only in the union comparison because the buggy calculator grouped by UTC date.

## Phase 4 implementation assistance

Implemented only `check.js`, the `check` and `check:map` npm scripts, and the requested `reports/flags.csv`, `reports/summary.csv`, and `reports/map.html` evidence outputs. The CLI validates input, detects six independent QA categories plus supplementary trip gaps, reports speed distributions, reuses the existing naive calculator and expected CSV, and leaves corrected metrics blank for Phase 5.

## Phase 4 debugging and decisions

- Corrected an initial per-driver-summary variable-reference error found by `npm run check`.
- Corrected an initial local-midnight detector result of zero. The dataset has exact UTC+9 midnight samples, so the final detector records path-level transitions only when adjacent positive-duration samples exist on both sides.
- Corrected an initial Leaflet legend-control construction error found during browser inspection.
- Used a proposed 5-minute trip-gap threshold based on the 10-second synthetic sampling contract.
- Kept speed outlier attribution ambiguous when geometry could not distinguish an endpoint; no point was automatically removed.

## Phase 4 actual verification

- `npm run check` completed successfully over all 3,630 records.
- `npm run check:map` completed successfully and created the map.
- Detected 15 duplicate records, 15 out-of-order records, 18 off-road records, 30 excessive-speed edges affecting 45 points, 16 zone-edge events affecting 28 points, 10 local-midnight transitions, and 10 trip gaps.
- Raw speed distribution: min `0`, p50 `20.200478`, p99 `128.032332`, max `288.003532` km/h.
- Preliminary below-150 km/h distribution: count `3570`, max `148.268819` km/h. This is diagnostic filtering only, not a corrected calculator.
- Evidence files contained 3,630 flag rows and 15 billing-summary rows. Fixed columns remained blank.
- Browser inspection loaded Leaflet, controls, legend, route layers, and markers without JavaScript errors after correction. External OpenStreetMap tile requests were unavailable in the environment, so map tiles could not be visually verified.

## Verification evidence

Actual Phase 1 checks are recorded in the final response for this task.

## Phase 2 implementation assistance

Implemented only `src/gen.js` and generated the four requested synthetic data files. The generator creates the fictional Tokyo road and campaign polygon, builds clean trajectories for five drivers across three UTC+9 dates, calculates independent ground truth from the clean trajectories, injects the four requested fault labels, and writes deterministic CSV/GeoJSON output.

## Significant technical decisions

- Used a GeoJSON `FeatureCollection` containing one `LineString` for `road.geojson`.
- Used a simple closed GeoJSON `Polygon` for `zone.geojson`.
- Used an explicit Luxon `+09:00` offset for reporting dates and midnight splitting.
- Used Turf boundary intersections and midpoint classification for partial segment clipping.
- Wrote a complete five-driver-by-three-date matrix to `expected.csv`, including zero rows if applicable.
- Used deterministic seed-based arrival jitter and stable output ordering.
- Marked duplicate observational fields as copied exactly; the `injected_fault=duplicate` value is diagnostic metadata.

## Executed validation commands

- `node src/gen.js --seed 42`
- Independent Node.js CSV/GeoJSON validation using `csv-parse`, Luxon, and Turf.
- Two `node src/gen.js --seed 42` runs with SHA-256 hashes of all four generated output files.

## Actual results

- 3,630 total records and 3,615 clean trajectory records.
- Five drivers and three UTC+9 reporting dates.
- 15 records each for `off_road`, `speed_spike`, `duplicate`, and `late`.
- 10 trips crossing local midnight.
- 8 clean-trajectory campaign boundary crossings.
- Expected billable total: 157.075855 km.
- Independent checks confirmed valid UTC timestamps, valid coordinates, all fault labels, off-road distance over 100 m, speed over 150 km/h, duplicate observational fields, late-arrival disorder, nonnegative expected values, and billable distance below clean total distance.
- All four output-file hash comparisons matched.
