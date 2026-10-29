# Loom Walkthrough Script

Target duration: approximately five minutes. This is a script only; no recording has been made.

## 0:00–0:35 — Scenario and business problem

**Show:** [README.md](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/README.md) or the project folder, then the business-rule summary.

**Say:** “This is a fictional vehicle advertising billing project. GPS positions arrive every ten seconds, and advertisers pay for kilometres driven inside a campaign zone. The risk is that noisy, late, duplicated, or badly grouped GPS data can change the billable distance.”

**Evidence:** [ASSUMPTIONS.md](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/ASSUMPTIONS.md) and [README.md](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/README.md).

## 0:35–1:15 — Dataset and intentional reference defects

**Show:** [data/pings.csv](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/data/pings.csv), [data/expected.csv](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/data/expected.csv), and [src/naiveCalc.js](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/src/naiveCalc.js).

**Say:** “The dataset is deterministic synthetic data: 3,630 GPS records, five drivers, and three reporting dates. The naive calculator is intentionally incorrect. It preserves arrival order, skips filtering and deduplication, groups by UTC date, and bills whole endpoint-selected segments.”

**Evidence:** [reports/naive_comparison.csv](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/reports/naive_comparison.csv) and [QA_LOG.md](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/QA_LOG.md).

## 1:15–2:05 — QA diagnostic CLI and fault evidence

**Show:** Run `npm run check`, then open [reports/flags.csv](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/reports/flags.csv).

**Say:** “The diagnostic tool processes all 3,630 rows. The observed diagnostics are 15 duplicates removed, 18 off-road rejections, 12 speed-stage rejections, and 10 proposed trip-gap exclusions. Injected labels are comparison metadata; the fixed calculator does not use them to decide what to remove.”

**Evidence:** [reports/flags.csv](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/reports/flags.csv), [reports/summary.csv](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/reports/summary.csv), and [check.js](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/check.js).

## 2:05–3:00 — Before and after comparison

**Show:** [reports/summary.csv](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/reports/summary.csv) and the before/after table in [directive.md](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/directive.md).

**Say:** “The report contains all 15 driver/date rows. Using the report-rounded values, the naive absolute difference is 112.150726 kilometres and the fixed absolute difference is 0.000191 kilometres. The naive signed difference is positive 98.385632 kilometres; the fixed signed difference is negative 0.000077 kilometres. These are distance differences, not monetary losses.”

**Evidence:** [reports/summary.csv](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/reports/summary.csv) and [reports/naive_comparison.csv](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/reports/naive_comparison.csv).

## 3:00–3:45 — Regression tests and independent checks

**Show:** Run `npm test`, then show [reports/test_results.json](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/reports/test_results.json), [tests/regression.test.js](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/tests/regression.test.js), and [tests/independentOracle.js](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/tests/independentOracle.js).

**Say:** “There are 38 tests: 32 ordinary passes and six expected naive failures. The expected failures are Vitest `it.fails` cases for the intentionally buggy reference implementation. The hand-built tests independently calculate selected distances and midnight ratios; the full generated expected file is still partly model-dependent.”

**Evidence:** [reports/test_results.json](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/reports/test_results.json).

## 3:45–4:30 — Prioritization, AI collaboration, and corrections

**Show:** [intent.md](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/intent.md), [QA_LOG.md](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/QA_LOG.md), and [AI_LOG.md](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/AI_LOG.md).

**Say:** “I prioritized zone-boundary billing retrospectively because it is an explicit rule and repeated crossings were observed. The remediation also corrected validation, canonical duplicate identity, summary-key coverage, and evidence documentation. AI assistance is recorded, while human review remains pending.”

**Evidence:** [intent.md](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/intent.md) and [AI_LOG.md](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/AI_LOG.md).

## 4:30–5:00 — Limitations and conclusion

**Show:** The “Still not solved” section of [directive.md](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/directive.md).

**Say:** “The result is ready with limitations. The five-minute trip-gap threshold, speed endpoint selection, reconnect policy, and boundary policy still need business confirmation. The map depends on CDN tiles, and the full expected dataset is not fully independent of the production geometry model. Repository, commit, and Loom placeholders remain to be completed.”

**Evidence:** [directive.md](C:/Users/yowow/OneDrive/Desktop/MUST/match-hire-gps-qa/directive.md).
