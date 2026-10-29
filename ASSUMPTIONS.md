# GPS Billing QA Assumptions

This document separates the explicit assessment rules from interpretations that still require review. Items marked `PROPOSED — NEEDS REVIEW` are working assumptions only and must not be treated as confirmed requirements.

## Explicit assessment rules

- GPS pings more than 100 metres from the road are ignored.
- GPS pings implying speeds above 150 km/h are ignored.
- Duplicate pings are identified by driver ID and GPS timestamp and count only once.
- Late and out-of-order pings are processed by GPS timestamp rather than arrival order.
- GPS timestamps are UTC; daily reporting uses a fixed UTC+9 local date.
- Only distance inside the campaign polygon counts, including partial segments crossing its boundary.

## Proposed interpretations requiring review

### Road-distance threshold

`PROPOSED — NEEDS REVIEW`: A ping exactly 100 metres from the road is accepted because the rule rejects pings **more than** 100 metres away. A ping at 100.000... metres, according to the chosen numerical precision, is rejected only when the measured value is strictly greater than 100 metres.

### Speed threshold

`PROPOSED — NEEDS REVIEW`: A ping implying exactly 150 km/h is accepted because the rule rejects speeds **above** 150 km/h. Only a strictly greater value is considered excessive.

### Duplicate timestamps with conflicting coordinates

`PROPOSED — NEEDS REVIEW`: The first record encountered for a driver/timestamp key is retained for auditability, and later records with the same key are ignored as duplicates even when coordinates differ. The implementation should log the conflict rather than silently treating conflicting coordinates as equivalent. This choice needs confirmation because the explicit rule defines the key but does not define conflict resolution.

`PROPOSED — NEEDS REVIEW`: In the synthetic CSV, a duplicate row copies the source observation fields (`driver_id`, GPS timestamp, arrival timestamp, latitude, and longitude). Its `injected_fault=duplicate` value is diagnostic metadata used to identify the injected row, so that label intentionally differs from the clean source's empty label.

### Detecting out-of-order arrivals

`PROPOSED — NEEDS REVIEW`: Preserve input/arrival order long enough to compare each record's GPS timestamp with the previous record received for the same driver. A timestamp earlier than the previous received timestamp is an out-of-order arrival. Billing order is then rebuilt by sorting valid, de-duplicated records by GPS timestamp, with a deterministic tie-breaker such as original arrival index.

### Fixed UTC+9 reporting date

`PROPOSED — NEEDS REVIEW`: Convert each UTC timestamp to a fixed offset of `+09:00` using an explicit timezone offset, not the machine's local timezone and not a daylight-saving timezone database. The local calendar date after that conversion is the reporting date.

### Points on the campaign boundary

`PROPOSED — NEEDS REVIEW`: Treat points exactly on the polygon boundary as inside the campaign zone. This is the inclusive interpretation of “inside” and avoids losing a point due only to boundary precision. The geometric library's boundary behavior must be checked and, if needed, normalized explicitly.

### Segments crossing a polygon boundary multiple times

`PROPOSED — NEEDS REVIEW`: Split a segment at every intersection with the polygon boundary, classify each resulting sub-segment, and sum only the portions inside. If a segment can intersect multiple polygon edges or a complex polygon, all crossings should be considered rather than stopping at the first intersection. Polygon validity and holes require review before implementation.

### Segments crossing local midnight

`PROPOSED — NEEDS REVIEW`: Attribute distance to the local reporting date of the segment's elapsed time, splitting the segment at every UTC+9 local-midnight boundary when a segment spans midnight. Distance should be apportioned by the segment's time fraction unless the final business decision specifies another allocation method.

### Which point to remove for excessive consecutive-ping speed

`PROPOSED — NEEDS REVIEW`: For a pair of consecutive points whose implied speed exceeds 150 km/h, remove the later point in GPS-time order as the suspected outlier, while retaining the earlier point. This is deterministic but not necessarily the only valid forensic choice; a future rule may instead remove the point with the larger road distance or use neighboring context.

### Recalculating speed after removing an outlier

`PROPOSED — NEEDS REVIEW`: Recalculate the speed between the remaining neighboring points after an outlier is removed, because the removal changes adjacency. Continue until no remaining consecutive pair exceeds 150 km/h, while recording each removal and recalculation for evidence. The stopping rule and whether chained removals are desired need confirmation.

### Driver with only one valid ping

`PROPOSED — NEEDS REVIEW`: A driver with one valid ping contributes zero distance because a segment requires two points. The ping may still be retained in diagnostics and daily-driver counts if those metrics are later defined.

### Zero expected distance in error percentages

`PROPOSED — NEEDS REVIEW`: When expected distance is zero, do not divide by zero. Report the percentage as `0%` when actual distance is also zero; otherwise report it as undefined/not applicable and expose the absolute difference separately. The final report format needs confirmation.

### GPS drift below the rejection threshold

`PROPOSED — NEEDS REVIEW`: A ping at or below the 100-metre road-distance threshold is retained even if it reflects small GPS drift. No smoothing or correction should be applied unless the assessment explicitly adds it; retaining raw observations preserves reproducibility.

### Deterministic synthetic data generation

`PROPOSED — NEEDS REVIEW`: Use a documented fixed seed, fixed input parameters, stable driver IDs, and stable timestamp ordering rules. Generation should produce the same files and values on repeated runs, with no current time, random seed, network data, or machine timezone dependency. The seed and scenario catalog need review before data generation begins.

## Items intentionally deferred

No GPS calculations, synthetic datasets, calculators, QA detection tool, or regression tests are implemented in Phase 1. Geometry, speed, date allocation, and conflict-resolution behavior must be approved before those later phases.

## Phase 7.1 clarified proposals

- `PROPOSED — NEEDS REVIEW`: Boundary points and positive-length travel exactly along an outer campaign boundary are billable. Polygon holes are non-billable, except for boundary travel if the business policy explicitly qualifies it.
- `PROPOSED — NEEDS REVIEW`: Speed filtering uses neighboring evidence first. If an excessive-speed edge remains ambiguous, the endpoint with greater road deviation is removed, with the later endpoint as the deterministic tie-breaker.
- `PROPOSED — NEEDS REVIEW`: Parsed UTC epoch milliseconds, rather than timestamp spelling, define duplicate identity. Conflicting coordinates are retained in diagnostics while the first deterministic observation is used for billing.
