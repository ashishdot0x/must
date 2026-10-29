# Investigation Intent

## Context

This fictional platform records a vehicle's GPS position every ten seconds. Advertisers are billed for kilometres driven inside a campaign zone. Billing must reject unreliable observations, process late arrivals in GPS-time order, use the fixed UTC+9 reporting calendar, and bill only the portion of a segment inside the campaign zone.

The investigation uses deterministic synthetic data. It does not contain real vehicle or driver information.

## Problems discovered

The following findings are separated between deliberately injected reference defects and additional QA findings. The intentionally incorrect implementation in `src/naiveCalc.js` is a test oracle for detection; it is not presented as a production incident.

| ID | Rule | Expected behavior | Observed behavior and evidence | Quantified impact | Advertiser / driver impact | Confidence and limitations |
|---|---|---|---|---|---|---|
| NAIVE-01 | GPS order, noise, speed, duplicates, and trip continuity | Process valid observations chronologically, filter invalid observations, deduplicate, and avoid unrelated trip joins. | The naive calculator processes arrival order and intentionally omits these filters. Evidence: `src/naiveCalc.js`, `reports/naive_comparison.csv`. | Combined naive absolute error is 112.150725384 km by direct calculation. The contribution of this finding alone is not independently isolated. | Advertisers may be over- or under-billed; driver distance attribution may be wrong. | Confirmed intentional reference behavior. Defects interact. |
| NAIVE-02 | Daily reporting uses UTC+9 | Allocate billable distance by fixed UTC+9 local date. | Naive output groups by UTC date. The union comparison shows zero naive distance on 2026-01-03 where expected values are nonzero. Evidence: `src/naiveCalc.js`, `reports/naive_comparison.csv`. | The three 2026-01-03 expected rows total 6.882547 km and are underreported by the naive date grouping. This is not the sole attribution of total error. | Distance can be assigned to the wrong advertiser reporting day. | Confirmed implementation defect; interaction with other naive defects remains. |
| NAIVE-03 | Partial campaign-zone segments | Bill only the segment portion inside the polygon. | Naive billing counts the whole segment whenever either endpoint is inside. Evidence: `src/naiveCalc.js`, `data/zone.geojson`, and the documented Phase 3 inspection. | 20 endpoint-crossing segments were observed. The inspection found 35.612824 km of whole selected segments versus approximately 24.916374 km of inside portions, an approximate 10.696451 km overcount opportunity. This is not an isolated billing attribution. | Advertisers may be over-billed for travel outside the campaign zone. | Confirmed intentional reference defect; measurement includes interacting data effects. |
| NAIVE-04 | Duplicate timestamps count once | Keep one observation for each driver and GPS instant. | Fifteen duplicate records remain in the naive stream. They are exact-coordinate duplicates in this dataset. Evidence: `data/pings.csv`, `src/naiveCalc.js`, and Phase 3 duplicate comparison. | Direct distance change from these exact duplicates was 0 km. A conflicting duplicate could have a different impact. | Potential duplicate billing or inconsistent route continuity. | Confirmed behavior; current synthetic duplicates mask direct distance impact. |
| QA-04-01 | Off-road rejection | Reject observations more than 100 m from the road. | Eighteen observations exceeded the threshold: 15 `off_road` labels and three overlapping `speed_spike` records. Evidence: `reports/flags.csv`, `src/fixedCalc.js`. | 18 observations rejected by the fixed filter. A defect-specific billing amount was not independently isolated. | Off-road noise could create non-road billable distance. | Confirmed diagnostic result; labels are metadata, not filtering input. |
| QA-04-02 | Speed rejection | Reject implied speeds above 150 km/h. | Thirty chronological edges exceeded 150 km/h and affected 45 unique endpoint records in the diagnostic report. The fixed stage rejected 12 points after recomputation. Evidence: `reports/flags.csv`, `reports/summary.csv`, `src/fixedCalc.js`. | Raw speed maximum was 288.003532 km/h. The 12-point rejection count is not equal to the 15 injected labels because faults overlap and endpoint responsibility is ambiguous. | Invalid movement can distort distance and daily billing. | Confirmed edge evidence and filtering result; exact bad endpoint is not always identifiable. |
| QA-04-03 | Trip boundaries | Do not connect separate driving sessions. | There is no `trip_id`; the fixed calculator uses a proposed five-minute gap threshold and excluded 10 edges. Evidence: `ASSUMPTIONS.md`, `src/fixedCalc.js`, `reports/flags.csv`. | 10 trip-gap edges excluded. Independent billing impact was not isolated. | Unrelated sessions could be joined and billed as one route. | Confirmed observation; threshold requires business approval. |
| PH7-01 | Polygon geometry | Handle holes, boundaries, tangencies, vertices, and multiple intersections according to an approved policy. | The corrected clipper handles the tested ring cases and uses the proposed policy that boundary travel is billable while hole interiors are not. Evidence: `src/geo.js`, `tests/regression.test.js`. | No separate full-dataset defect amount was attributed. | Incorrect topology can over- or under-bill zone travel. | Regression-tested, but arbitrary self-intersecting and non-finite polygons remain outside the validated scope. |

## Prioritization

| Rank | Finding group | Rationale |
|---:|---|---|
| 1 | Zone-boundary billing | The supplied rule explicitly requires partial clipping, and the inspection found 20 crossing segments with an approximate 10.696451 km overcount opportunity. The impact can be high, although it is not independently isolated from other naive defects. |
| 2 | UTC+9 daily allocation | A reporting-date error can place otherwise valid distance on the wrong advertiser day. The naive comparison shows 6.882547 km on the affected 2026-01-03 expected rows. |
| 3 | Off-road and speed filtering | These rules directly control whether observations are billable. The dataset produced 18 off-road rejections and 12 speed-stage rejections, with overlapping injected evidence. |
| 4 | Arrival order and trip gaps | Wrong adjacency affects distance, speed, and zone decisions. Fifteen delayed arrivals and 10 proposed trip-gap exclusions were observed. |
| 5 | Duplicate handling | Fifteen duplicates were present, but their exact coordinates produced 0 km direct distance change in this dataset. The risk is higher for conflicting duplicates. |

The ranking combines billing correctness, observed frequency, potential customer consequence, evidence confidence, and implementation effort. It is not a claim that the combined 112.150725384 km error belongs to any one finding. Where a defect-specific value has not been isolated, the correct statement is **Not independently isolated**.

## What I chose to solve first

The zone-boundary problem was selected as the retrospective investigation priority because it is an explicit billing rule and the inspection found repeated boundary-crossing segments with a measurable overcount opportunity. The logs do not establish that this was historically the first implementation change, so this is a retrospective prioritization, not a historical claim about development order.

The implementation pipeline also addressed validation, canonical duplicate identity, complete summary-key coverage, and regression evidence because those changes improve the reliability of the investigation itself.

## What I left out

The following remain documented assumptions or limitations rather than silently resolved requirements:

- The five-minute maximum trip-continuity gap is `PROPOSED — NEEDS REVIEW`.
- Speed filtering can identify an excessive-speed edge without uniquely identifying which endpoint is faulty; the current policy uses neighboring evidence and a deterministic tie-breaker.
- Reconnecting observations after rejecting a point is an implementation assumption.
- Boundary points and positive-length boundary travel are treated as inside under a proposed policy; hole-boundary behavior also requires business approval.
- Polygon validation does not establish correctness for every self-intersecting or non-finite polygon.
- The full generated expected dataset is not mathematically independent of the fixed calculator. Independent evidence is strongest for the hand-built analytical fixtures and midnight ratios in `tests/independentOracle.js`.
- No monetary loss is calculated because no billing rate was supplied.
