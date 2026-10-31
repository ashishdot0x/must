# QA Log

## Observation

_(No findings recorded yet.)_

## Evidence

_(Add links, file names, commands, or captured outputs when an observation is investigated.)_

## Business rule affected

_(Identify the applicable rule when a finding exists.)_

## Expected behavior

_(Record the expected behavior from the requirement or approved assumption.)_

## Actual behavior

_(Record observed behavior only; do not infer results without evidence.)_

## Potential advertiser/driver impact

_(Assess only after the behavior is reproduced and understood.)_

## Severity

_(To be assigned after evidence-based triage.)_

## Investigation status

_(Not started.)_

## Fix verification

The first generator execution exposed an implementation error: the road `LineString` was wrapped as a nested Turf feature, so Turf could not read its coordinates. The constructor was corrected, and the generator then executed successfully. This was a generator implementation issue, not a fabricated business-rule finding.

## Phase 3 findings

### Finding NAIVE-01

- Problem description: The reference calculator processes each driver's records in arrival order, does not filter excessive speeds or off-road points, does not deduplicate, and connects records across implicit trip boundaries.
- Expected behavior: Process valid, de-duplicated points by GPS timestamp, apply road and speed rules, and avoid connecting separate driving sessions.
- Actual behavior: The intentionally buggy calculator preserves arrival order and all valid numeric records, including fault-injected records and large inter-trip gaps.
- Evidence source: `src/naiveCalc.js`, `data/pings.csv`, and `node scripts/compareNaive.js`.
- Observed impact: The comparison produced a total absolute error of 112.150725 km and an overall signed difference of 98.385631 km. This total is not attributed to this finding alone because the intentional defects interact.
- Severity rationale: High potential billing risk because multiple independent business rules are bypassed.
- Investigation status: Confirmed as intentional reference behavior; independent contribution not isolated.

### Finding NAIVE-02

- Problem description: Daily grouping uses UTC calendar dates instead of fixed UTC+9 reporting dates.
- Expected behavior: Report by UTC+9 local calendar date.
- Actual behavior: The naive output has billable records on UTC dates 2026-01-01 and 2026-01-02 only. The comparison union displays 2026-01-03 with zero naive distance, while expected.csv contains nonzero UTC+9 distance for that date.
- Evidence source: `src/naiveCalc.js`, `data/expected.csv`, and `reports/naive_comparison.csv`.
- Observed impact: The three expected 2026-01-03 values are underreported by a combined 6.882547 km in the comparison. This is a date-allocation observation, not a claim about the total error's sole cause.
- Severity rationale: High because distance can be assigned to the wrong advertiser reporting day.
- Investigation status: Confirmed.

### Finding NAIVE-03

- Problem description: The zone calculation bills an entire segment when either endpoint is inside instead of clipping the segment at polygon boundaries.
- Expected behavior: Bill only the segment portion inside the campaign polygon.
- Actual behavior: 20 endpoint-crossing segments were observed in the inspected stream. A separate sanity calculation found 35.612824 km of full endpoint-selected segment distance versus approximately 24.916374 km of inside portions, an approximate 10.696451 km overcount opportunity. This calculation includes arrival-order and fault/trip effects and is not an isolated bug attribution.
- Evidence source: `src/naiveCalc.js`, `data/zone.geojson`, and the independent Turf inspection command.
- Observed impact: Potential overbilling on boundary-crossing segments.
- Severity rationale: High because the rule explicitly requires partial boundary segments to be clipped.
- Investigation status: Confirmed implementation defect; isolated contribution remains unmeasured.

### Finding NAIVE-04

- Problem description: Exact duplicate records are retained.
- Expected behavior: A driver/timestamp duplicate counts once.
- Actual behavior: 15 duplicate rows remain in the processing stream. Their observational fields are exact copies, so the measured direct distance delta from removing them was 0 km in this dataset.
- Evidence source: `data/pings.csv`, `src/naiveCalc.js`, and the duplicate-removal comparison command.
- Observed impact: No direct distance change for these exact-coordinate duplicates; the defect remains real for nonzero-coordinate conflicts or other duplicate shapes.
- Severity rationale: Medium potential risk; current synthetic duplicate construction masks direct impact.
- Investigation status: Confirmed behavior; current direct impact measured as 0 km.

## Phase 4 diagnostic findings

### Finding QA-04-01 — Duplicate identities

- Rule violated: `duplicate`.
- Actual evidence: 15 repeated driver/timestamp identities were flagged in `reports/flags.csv`; the first arrival-order record for each identity was retained as the reference.
- Affected driver/timestamp: 15 source rows, distributed across all five drivers and three trips each.
- Potential billing impact: Duplicate observations can cause double processing; these exact-coordinate duplicates did not add distance in the Phase 3 naive calculation.
- Detection method: Grouped by `driver_id + ts_utc` in actual CSV arrival order and flagged every record after the first.
- Severity rationale: Medium; current duplicate construction masks direct distance impact.
- Status: Confirmed detection; no coordinate conflicts observed.

### Finding QA-04-02 — Arrival-order disorder

- Rule violated: `out_of_order`.
- Actual evidence: 15 records were flagged because their GPS timestamps preceded a previously observed timestamp for the same driver in CSV arrival order.
- Affected driver/timestamp: 15 records labeled `clean` by the generator, corresponding to delayed arrivals.
- Potential billing impact: Arrival-order processing can connect points in the wrong temporal sequence.
- Detection method: Compared each GPS timestamp to the previous observed timestamp per driver without sorting first.
- Severity rationale: High because billing distance and speed depend on chronological adjacency.
- Status: Confirmed.

### Finding QA-04-03 — Off-road points

- Rule violated: `off_road`.
- Actual evidence: 18 points exceeded 100 metres from the road: 15 injected off-road points and 3 points labeled `speed_spike` that also exceeded the road threshold.
- Affected driver/timestamp: Recorded with source row and coordinates in `reports/flags.csv`.
- Potential billing impact: Off-road observations may contribute non-road distance.
- Detection method: Turf `pointToLineDistance` in metres with a strict `>100` threshold.
- Severity rationale: High because the rule explicitly rejects points beyond the threshold.
- Status: Confirmed; overlap with speed-spike evidence is intentional and not treated as a one-to-one label match.

### Finding QA-04-04 — Excessive-speed edges

- Rule violated: `speed_spike`.
- Actual evidence: 30 chronological edges exceeded 150 km/h, affecting 45 unique endpoint records. Raw speed statistics were min 0, p50 20.200478, p99 128.032332, and max 288.003532 km/h.
- Affected driver/timestamp: Source rows and edge details are preserved in `reports/flags.csv`.
- Potential billing impact: Invalid movement can distort both segment distance and downstream daily billing.
- Detection method: Chronological geographic speed calculation using GPS timestamps; duplicate timestamps and trip-gap edges excluded.
- Severity rationale: High because observed speeds exceed the explicit threshold.
- Status: Confirmed edge evidence; suspected endpoint remains ambiguous unless road geometry provides a stronger signal.

### Finding QA-04-05 — Campaign boundary segments

- Rule violated: `zone_edge_segment`.
- Actual evidence: 16 chronological segments intersected or touched the campaign polygon boundary, affecting 28 endpoint records.
- Affected driver/timestamp: Preserved in `reports/flags.csv`.
- Potential billing impact: Whole-segment billing can overcount partial boundary crossings.
- Detection method: Turf line/polygon-boundary intersection plus endpoint-inside checks, without using injected labels.
- Severity rationale: High because partial segments must be clipped.
- Status: Confirmed diagnostic evidence; this tool does not calculate corrected billable distance.

### Finding QA-04-06 — Local-midnight transitions and trip gaps

- Rule violated: `crosses_local_midnight`; supplementary `trip_gap` diagnostic.
- Actual evidence: 10 path-level UTC+9 midnight transitions and 10 gaps above the proposed 5-minute threshold were detected. Exact-midnight samples were handled as boundary-adjacent transitions, not as positive-duration crossing edges.
- Affected driver/timestamp: Details are preserved in `reports/flags.csv`.
- Potential billing impact: UTC-vs-UTC+9 grouping can assign distance to the wrong reporting day; connecting trip gaps can add unrelated movement.
- Detection method: Luxon fixed `+09:00` timestamps and chronological per-driver records; trip-gap edges were not used for speed or zone calculations.
- Severity rationale: High potential reporting risk; trip inference remains provisional.
- Status: Confirmed observations; the 5-minute threshold is proposed and requires review.

## Phase 5 fixed-calculator findings

### Finding FIXED-05-01 — Corrected billing path matches independent expected values

- Problem description: The fixed path must sort by GPS timestamp, remove duplicates, reject off-road and excessive-speed observations, stop at trip gaps, clip zone crossings, and split distance at fixed UTC+9 midnights.
- Expected behavior: Fixed daily values should agree with the unchanged `data/expected.csv` clean-path ground truth within the assessment tolerance.
- Actual behavior: The fixed calculator produced all 15 expected driver/date rows. The largest absolute percentage difference was `0.001070514%`; total absolute difference was `0.000188524 km`; total signed difference was `-0.000074914 km`.
- Evidence source: `src/geo.js`, `src/fixedCalc.js`, `reports/summary.csv`, direct Node comparison, and `npm.cmd run check`.
- Observed impact: No material discrepancy was observed against the independent expected values in this dataset.
- Severity rationale: Pass evidence for the current synthetic dataset; broader edge cases still require regression tests.
- Investigation status: Confirmed for the current dataset.

### Finding FIXED-05-02 — Fixed pipeline diagnostics

- Problem description: Fault handling must be observable without using `injected_fault` as a processing decision.
- Expected behavior: Diagnostics should be derived from timestamps, coordinates, road geometry, speed, and zone geometry; the label remains comparison metadata.
- Actual behavior: `fixedDistanceDetailed` reported `invalid=0`, `duplicates_removed=15`, `off_road_rejected=18`, `speed_outliers_rejected=12`, and `trip_gaps_excluded=10`. Source inspection found no `injected_fault` reference in `src/fixedCalc.js` or `src/geo.js`.
- Evidence source: `src/fixedCalc.js`, `src/geo.js`, `reports/summary.csv`, and the executed validation command with an invalid timestamp/duplicate/trip-gap sample.
- Observed impact: The current data produced finite output and preserved the input array.
- Severity rationale: Pass for the inspected dataset and implementation path; edge-case semantics need tests.
- Investigation status: Confirmed for current validation.

### Finding FIXED-05-03 — Trip-gap threshold remains a proposed interpretation

- Problem description: The dataset has implicit trips but no explicit `trip_id`.
- Expected behavior: Unrelated sessions must not be connected.
- Actual behavior: The fixed calculator uses the proposed 5-minute gap threshold and excluded 10 trip-gap edges. The threshold is not an explicit assessment requirement.
- Evidence source: `src/fixedCalc.js`, `reports/summary.csv`, and Phase 2/4 documentation.
- Observed impact: No material fixed-vs-expected discrepancy resulted in this dataset, but different gap distributions could change billing.
- Severity rationale: Medium unresolved business interpretation.
- Investigation status: `PROPOSED — NEEDS REVIEW`.

### Finding FIXED-05-04 — Green map path now uses retained fixed records

- Problem description: The diagnostic map must not display a separately guessed filtered path.
- Expected behavior: The green path should use the same retained records as the fixed calculator.
- Actual behavior: `check.js` passes `fixed.retainedByDriver` to map generation; the regenerated HTML contains the raw red route, fixed green retained route, campaign-zone layer, and flagged-point popups.
- Evidence source: `check.js`, `reports/map.html`, `npm.cmd run check:map`, and the shared browser page inspection. OpenStreetMap tile requests failed in the environment, so base-map imagery was not verified.
- Observed impact: Diagnostic geometry remains inspectable without relying on injected labels.
- Severity rationale: Low implementation-risk observation; browser rendering is environment-limited.
- Investigation status: Confirmed source/report evidence; visual tile verification limited.

## Phase 6 regression evidence

### Finding REG-06-01 — Inclusive numeric thresholds need floating-point protection

- Requirement tested: Exactly 100 metres from the road and exactly 150 km/h are accepted because the explicit rules reject only values greater than the thresholds.
- Test names: `accepts a point measured at 100 metres from the road within geometry tolerance`; `accepts an implied speed at 150 km/h within numerical tolerance`.
- Initial actual result: The 100 m failure was caused by an incorrectly constructed test fixture whose first point was off-road. The 150 km/h fixture measured `150.00000000000006 km/h` and was rejected by a strict comparison.
- Change made: Added a `1e-9` numerical threshold epsilon in `src/fixedCalc.js` for road-distance and speed comparisons. This preserves rejection of materially greater values while accepting floating-point representations of the inclusive boundary.
- Final actual result: Both tests pass.
- Evidence source: `tests/regression.test.js`, `src/fixedCalc.js`, and the executed Vitest runs.
- Status: Confirmed regression coverage.

### Finding REG-06-02 — Fixed regression suite

- Requirement tested: Six business rules plus high-risk edge cases and an independent end-to-end comparison.
- Test names: Six `core business rule` scenarios, 12 `threshold and edge-case regressions`, and `end-to-end independent expected CSV comparison`.
- Expected result: Fixed implementation passes; intentionally buggy implementation fails only where the scenario demonstrates its documented defect.
- Actual result: `npm.cmd run test` exited 0 with 19 normal passes and 6 expected failures. The JSON report recorded 25 total, 25 passed, 0 failed, 0 pending because Vitest treats `it.fails` outcomes as passing expected-failure assertions.
- Evidence source: `reports/test_results.json` and terminal output from `npm.cmd run test`.
- Associated risk: The six expected naive failures demonstrate off-road filtering, speed filtering, deduplication, timestamp ordering, UTC+9 allocation, and zone clipping defects. They are not evidence that every naive defect has independent monetary impact.
- Status: Confirmed.

## Phase 7.1 executed validation

- `npm.cmd run test` exited `0`: 32 normal passes, 6 expected naive failures, 0 unexpected failures, and 0 skipped tests across 38 tests.
- `npm.cmd run test:report` exited `0`; `reports/test_results.json` records 38 total, 38 passed, 0 failed, and 0 pending because Vitest records expected failures as passing assertions.
- `npm.cmd run check` exited `0` over 3,630 records.
- `npm.cmd run check:map` exited `0` and regenerated the diagnostic map.
- Fixed diagnostics remained: invalid `0`, duplicate removals `15`, off-road rejections `18`, speed outlier removals `12`, and trip gaps `10`.
- The protected source dataset and naive implementation were not edited during remediation.

## Phase 7.1 remediation evidence

### Finding PH7-01 — Polygon geometry remediation

- Original defect: The clipper intersected only the exterior ring and classified geodesic midpoints, which failed polygon holes and boundary-aligned segments.
- Correction: `clipSegmentToZone` now validates closed polygon rings, intersects every outer and hole ring, uses linear-coordinate midpoints for topology classification, and treats boundary points/travel as billable under the clarified proposed policy.
- Verification: Added hand-built tests for inside, outside, entry/exit, outside-to-outside crossing, holes, boundary alignment, tangential contact, vertices, multiple hole crossings, and malformed polygons.
- Status: Confirmed by the executed regression suite; complex polygon policy remains proposed.

### Finding PH7-02 — Canonical duplicate timestamps

- Original defect: Duplicate identity used raw `ts_utc` text.
- Correction: Identity now uses parsed epoch milliseconds. Conflicting coordinates are recorded in `diagnostics.duplicateConflicts` while the first deterministic record remains the billing record.
- Verification: Regression coverage includes equivalent timestamp spellings and conflicting coordinates.
- Status: Confirmed corrected.

### Finding PH7-03 — Input validation

- Original defect: Empty coordinates could become zero through `Number('')`, and missing driver IDs could crash sorting.
- Correction: Empty/whitespace coordinates, invalid coordinates, invalid timestamps, and missing driver IDs are rejected with diagnostic reasons.
- Verification: Regression coverage checks invalid latitude, invalid timestamp, empty coordinate, and missing driver ID behavior.
- Status: Confirmed corrected.

### Finding PH7-04 — Summary key coverage

- Original defect: `check.js` omitted fixed-only driver/date keys from its billing-summary union.
- Correction: Added `buildBillingSummary` and included expected, naive, and fixed keys.
- Verification: A focused regression test asserts a fixed-only key is visible with `N/A` fixed percentage when expected distance is zero.
- Status: Confirmed corrected.

### Finding PH7-05 — Independent evidence clarification

- Original defect: The generated expected CSV and fixed calculator shared substantially similar clipping and midnight-allocation logic.
- Correction: Added `tests/independentOracle.js`, a small standalone haversine and elapsed-ratio oracle used by hand-built tests. The existing expected CSV was not changed.
- Limitation: Full-dataset expected values remain model-dependent because the generator and fixed calculator still use similar geometry assumptions. The new oracle independently verifies analytical fixtures, not every generated record.
- Status: Evidence quality improved; full independence remains explicitly limited.

### Finding PH7-06 — Documentation accuracy

- Original defect: The AI log retained an intermediate 25-test count as if it were final.
- Correction: The log now identifies the intermediate 25-test run and records the final Phase 6 result as 26 total tests, 20 normal passes, and 6 expected naive failures.
- Status: Confirmed corrected.

### Finding REG-06-03 — Injected labels versus fixed filtering stages

- Requirement tested: Diagnostic labels must not drive production filtering, and stage results must be explainable.
- Actual result: The 18 off-road removals include exactly three injected `speed_spike` records: source rows 610, 1822, and 3032. The remaining 12 injected speed-spike records were removed during the speed stage: source rows 608, 609, 611, 612, 1818, 1819, 1820, 1821, 3028, 3029, 3030, and 3031. No clean-labeled record was identified as removed by the speed stage in the executed analysis. Injected `late` records remain retained because late arrival is not a data-quality rejection rule.
- Evidence source: `data/pings.csv`, `reports/flags.csv`, `src/fixedCalc.js`, and the executed stage-reconciliation command.
- Status: Confirmed for this dataset.

### Finding REG-06-04 — End-to-end before/after evidence

- Requirement tested: Fixed absolute error must be lower than the naive baseline.
- Actual result: Naive absolute driver/day error remains `112.150725 km`; fixed absolute error is `0.000188524 km`; maximum fixed percentage error is `0.001070514%`. All 15 expected driver/date rows were present, finite, and within 1%; zero rows used a `0.00001 km` absolute tolerance.
- Evidence source: `reports/summary.csv`, `reports/naive_comparison.csv`, `reports/test_results.json`, and the executed `npm.cmd run check` command.
- Status: Confirmed.

## Submission status consistency check

- The configured GitHub remote is `https://github.com/ashishdot0x/must`; local Git metadata shows `main` and `origin/main` at `cc017364c15bc45a1eb5677741623c888f05a5dd43` (`chore: finalize GPS QA submission`).
- The inspected history contains the initial snapshot and this finalization commit, but no separate fix-only commit. The finalization commit is therefore labeled as the final snapshot; no commit was created or amended during this task.
- The GitHub repository is published, but the Loom video has not been recorded. No Loom video file or Loom link is included in the repository, and submission remains incomplete.
- This documentation consistency update did not change GPS calculation logic, the dataset, business rules, or tests.
