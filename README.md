# Match Hire GPS Billing QA

## Overview

This fictional assessment project investigates GPS-based advertising billing. Synthetic vehicle pings are generated at ten-second intervals. The QA tool identifies suspicious observations and compares an intentionally incorrect reference calculator with a corrected billing path.

The project contains no real GPS or driver data.

## Requirements

- Node.js 20 or newer
- npm
- ES modules enabled through `package.json`

The project uses Turf, Luxon, seedrandom, csv-parse, csv-stringify, and Vitest.

## Setup

```powershell
npm install
```

To recreate the deterministic synthetic dataset:

```powershell
node src/gen.js --seed 42
```

This regenerates files under `data/`. Do not run it when preserving an existing evidence snapshot without first saving that snapshot.

## Folder structure

```text
data/       synthetic pings, road, zone, and expected values
src/        generator, naive calculator, geometry, fixed calculator, billing helper
scripts/    comparison scripts
tests/      Vitest regression tests and independent analytical oracle
reports/    diagnostic flags, summaries, map, comparisons, and test JSON
```

## Commands

```powershell
node src/gen.js --seed 42
npm run check
npm run check:map
npm test
npm run test:report
```

The current package scripts are:

- `check`: run the diagnostic tool over `data/pings.csv`.
- `check:map`: run the diagnostic tool and generate `reports/map.html`.
- `test`: run Vitest.
- `test:report`: write the Vitest JSON report to `reports/test_results.json`.

## Generated data

The current deterministic dataset contains 3,630 GPS records for five fictional drivers over three UTC+9 reporting dates. It includes synthetic labels for duplicate, late, off-road, and speed-spike observations. Labels are diagnostic comparison metadata and are not used by the fixed calculator to filter records.

The current fixed diagnostics report 15 duplicate removals, 18 off-road rejections, 12 speed-stage outlier removals, and 10 proposed trip-gap exclusions. Label counts and diagnostic counts are different concepts and are not expected to match one-for-one.

## QA CLI

`check.js` reads the pings, road, zone, and expected CSV files. It produces:

- `reports/flags.csv` — row-level diagnostic evidence.
- `reports/summary.csv` — expected, naive, and fixed distance by driver and local date.
- `reports/naive_comparison.csv` — supplementary naive-versus-expected comparison.
- `reports/map.html` — raw and retained paths, campaign zone, and diagnostic markers.

The map uses CDN resources for base-map tiles when available; it is not guaranteed to be fully offline.

## Regression tests

The suite contains 38 tests: 32 ordinary passes and six expected failures for the intentionally buggy naive implementation. The suite covers the six business rules, invalid input, canonical duplicates, trip gaps, thresholds, polygon geometry, input immutability, finite outputs, summary-key coverage, and an end-to-end comparison.

The independent fixtures in `tests/independentOracle.js` calculate selected distances and elapsed-time ratios without importing production billing or clipping helpers. The full generated expected CSV remains partly dependent on shared geographic model assumptions and is not claimed to be mathematically independent.

## Evidence files

- `QA_LOG.md` — factual findings, corrections, and verification history.
- `AI_LOG.md` — AI assistance and actual command evidence.
- `ASSUMPTIONS.md` — supplied rules and proposed interpretations.
- `intent.md` — investigation, prioritization, and scope decisions.
- `directive.md` — engineering handoff, results, and limitations.

## Limitations

- The five-minute trip-gap threshold is proposed and needs business approval.
- Speed-outlier endpoint selection can be ambiguous.
- Reconnecting retained observations after filtering is an implementation assumption.
- General self-intersecting or non-finite polygon topology is not fully validated.
- Boundary and hole-boundary behavior is proposed rather than confirmed business policy.
- Full expected-data independence is limited by shared Turf/model assumptions.
- No billing rate is provided, so distance discrepancies are not converted to monetary values.

## Submission status

- GitHub repository: published at [github.com/ashishdot0x/must](https://github.com/ashishdot0x/must).
- Final snapshot: commit `cc017364c15bc45a1eb5677741623c888f05a5dd43`, `chore: finalize GPS QA submission`; no separate fix-only commit exists in the inspected history.
- Loom video: not recorded. No Loom video file or Loom link is included in this repository.
- Submission: incomplete pending the Loom recording.
