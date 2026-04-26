# Analytics Metric Catalog

This document catalogs the numbers shown in the admin analytics screen and the report-ready metrics that should be produced from the same source data.

The goal is to make the analytics pipeline auditable:

- where each displayed number comes from
- how it is calculated
- whether UI filters affect it
- whether it contains personally identifiable information
- whether it is safe for student-facing distribution

## Source Pipeline

Current analytics data flows through these layers.

| Layer | Path / table | Role | Contains PII | Notes |
| --- | --- | --- | --- | --- |
| Raw exercise record | `users/{uid}/attempts/{attemptId}` | Per-attempt record used for admin operations and backfill | Yes | Contains `uid`, `userName`, score, time, question-level details. TTL is configured through `expireAt`. |
| Live unit counters | `units/{unitId}/stats/questions` | Incremental question counters | No direct PII | Updated by `processDrillResult`. Used by older admin unit views, not by current analytics tab. |
| Live global counters | `stats/global` | Incremental global counters | No direct PII | Updated by `processDrillResult`, and manually reset/decremented by admin operations. |
| Analytics event log | `analytics_events/submit_{attemptId}` | Event source for BigQuery analytics | Yes | Contains `uid`, `unitId`, score, time, and `questionResults`. |
| BigQuery raw latest | `analytics.analytics_events_raw_latest` | Firestore extension synced source | Yes | Expected by `analyticsAggregation.ts`. |
| BigQuery facts | `analytics.fact_attempts`, `analytics.fact_attempt_question_results` | Derived normalized tables | Yes | Excludes reset/deleted events only if those events exist. |
| BigQuery aggregates | `analytics.agg_unit_daily`, `analytics.agg_question_daily`, `analytics.agg_question_pair_current` | Aggregate tables for serving docs | Mixed | Pair/current tables are aggregated but still based on uid-level joins. |
| Admin serving docs | `analytics_serving/current/...` | Admin screen read model | Yes in rankings | Firestore rules currently restrict to admins. |
| Public report serving docs | `public_analytics_serving/current/...` | Report-safe read model for admin export | No | Generated from aggregates with k-anonymity rules, and still admin-only in Firestore rules. |

## Event Contract

The current SQL already expects reset/delete events, but admin operations do not emit them yet.

| Event type | Current writer | Required writer | Purpose | Status |
| --- | --- | --- | --- | --- |
| `ATTEMPT_SUBMITTED` | `processDrillResult` | `processDrillResult` | Include a submitted attempt in analytics. | Implemented |
| `ATTEMPT_DELETED` | Admin attempt deletion flows | Admin single, batch, and user reset flows | Exclude a deleted attempt from BigQuery facts. | Implemented in admin UI |
| `ALL_DATA_RESET` | Admin full reset flow | Admin full reset flow | Exclude all submissions before reset time. | Implemented in admin UI |

## Admin Analytics Screen Catalog

### Top Highlight Cards

| Display | UI source | Serving doc field | BigQuery source / formula | Filtered today | Contains PII | Student report safe | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Active users / DAU | `AnalyticsHighlights` | `overview.totals.dau` | `COUNT(DISTINCT IF(occurred_date = CURRENT_DATE('Asia/Tokyo'), uid, NULL))` from `fact_attempts` | No | Aggregated uid count | Yes if k >= threshold | Currently global only. |
| WAU / MAU | `AnalyticsHighlights` | `overview.totals.wau`, `overview.totals.mau` | Distinct uid counts for last 7 / 30 days from `fact_attempts` | No | Aggregated uid count | Yes if k >= threshold | Currently global only. |
| Study time | `AnalyticsHighlights` | `overview.totals.totalStudyTimeSec` | `SUM(time_sec)` from `fact_attempts` | No | No | Yes | Display is seconds. Consider formatting minutes/hours. |
| Attempts per user | `AnalyticsHighlights` | `overview.totals.avgAttemptsPerUser` | `COUNT(*) / COUNT(DISTINCT uid)` from `fact_attempts` | No | Aggregated uid count | Yes if k >= threshold | Currently global only. |
| First attempt accuracy | `AnalyticsHighlights` | `overview.totals.firstAttemptAccuracy` | `AVG(is_correct WHERE first uid/unit/question attempt) * 100` from `fact_attempt_question_results` | No | Aggregated uid-based metric | Yes if k >= threshold | Good metric; needs clearer label. |
| Retry improvement rate | `AnalyticsHighlights` | `overview.totals.retryImprovementRate` | `AVG(retry is_correct) - AVG(first is_correct)` from `fact_attempt_question_results` | No | Aggregated uid-based metric | Yes if k >= threshold | Can be negative. UI should explain that. |
| At-risk users | `AnalyticsHighlights` | `overview.totals.atRiskUsers` | Count users with at least 10 answers and <50% accuracy in last 14 days | No | Aggregated sensitive student status | No for student report | Admin-only. Do not include in public reports. |

### Overview KPI Cards

| Display | UI source | Serving doc field | BigQuery source / formula | Filtered today | Contains PII | Student report safe | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Total answer submissions | `OverviewPanel.metrics.totalAttempts` | `overview.totals.totalAttempts` | `COUNT(*)` from `fact_attempts` | No | No | Yes | Label says submissions/drills; this counts attempts, not questions. |
| Play data count | `OverviewPanel.scoresCount` | `overview.totals.totalAttempts` | Same as total attempts | No | No | Yes | Duplicate of total attempts; label is misleading. |
| Overall average accuracy | `OverviewPanel.metrics.avgAccuracy` | `overview.totals.avgAccuracy` | `SUM(correct_count) / SUM(answered_count) * 100` | No | No | Yes | Correct global formula. |
| Tracked unit count | `OverviewPanel.metrics.unitAccuracies.length` | Derived from `unit_summaries` docs | Count of units returned from `analytics_serving/current/unit_summaries` | Yes, indirectly | No | Yes | Reflects subject/category filter because unit summaries are filtered in React. |

### Overview Charts

| Display | UI source | Serving doc field | BigQuery source / formula | Filtered today | Contains PII | Student report safe | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Unit average accuracy chart | `OverviewPanel.metrics.unitAccuracies` | `unit_summaries/{unitId}.totals.avgAccuracy` | `SUM(total_correct) / SUM(total_answered) * 100` from `agg_unit_daily` | Yes | No | Yes if unit unique users >= k | Current `uniqueUsers` in unit summary can be over-counted across days. |
| Category average accuracy chart | `calculateCategoryAccuraciesFromSummaries` | Derived in React from `unit_summaries` | Weighted by unit `totalAttempts`, using unit avg accuracy | Yes | No | Yes if category unique users >= k | Should move to BigQuery so category unique users and k-anonymity are reliable. |

### Admin Rankings

| Display | UI source | Serving doc field | BigQuery source / formula | Filtered today | Contains PII | Student report safe | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Top accuracy students | `overview.rankings.topAccuracy` | `overview.rankings.topAccuracy[]` | Per uid `SUM(correct_count) / SUM(answered_count) * 100`, `HAVING attempts >= 3` | No | Yes | No | Includes `uid` and `userName`. Admin-only. |
| Low accuracy students | `overview.rankings.worstAccuracy` | `overview.rankings.worstAccuracy[]` | Same as above, ascending | No | Yes, sensitive | No | Admin-only and should be labeled carefully. |
| Top correct count students | `overview.rankings.topCorrect` | `overview.rankings.topCorrect[]` | Per uid `SUM(correct_count)` | No | Yes | No | Admin-only. |
| Low correct count students | `overview.rankings.worstCorrect` | `overview.rankings.worstCorrect[]` | Per uid `SUM(correct_count)`, ascending | No | Yes, sensitive | No | Admin-only. |

Current status: global rankings now come from `overview/current`, selected-unit rankings come from `unit_rankings/{unitId}`, and subject/category overview docs are generated under `overview_by_subject` and `overview_by_category`. Subject/category docs use bulk scoped SQL so BigQuery job count does not grow by filter value.

### Question Analysis

| Display | UI source | Serving doc field | BigQuery source / formula | Filtered today | Contains PII | Student report safe | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Question total | `QuestionAnalysisPanel.questionStats[].total` | `question_analysis/{unitId}.questions[].total` | `SUM(total)` from `agg_question_daily` | Unit only | No | Yes if question support >= k | Counts question attempts. |
| Question correct | `questionStats[].correct` | `question_analysis/{unitId}.questions[].correct` | `SUM(correct)` from `agg_question_daily` | Unit only | No | Yes if question support >= k | Counts correct question attempts. |
| Question accuracy | `questionStats[].rate` | `question_analysis/{unitId}.questions[].accuracy` | `SUM(correct) / SUM(total) * 100` | Unit only | No | Yes if question support >= k | Correct formula. |
| Difficulty | `questionStats[].difficulty` | `question_analysis/{unitId}.questions[].difficulty` | Accuracy bucket: >=90 very_easy, >=70 easy, >=40 normal, >=20 hard, else very_hard | Unit only | No | Yes if question support >= k | Good for student report. |
| Accuracy distribution | `calculateAccuracyDistribution(questionStats)` | Derived in React | Count questions by accuracy bucket | Unit only | No | Yes if unit/question support >= k | Should be generated in public serving docs for reports. |
| Difficulty pie | `difficultyData` | Derived in React | Count questions by difficulty bucket | Unit only | No | Yes if unit/question support >= k | Same as above. |
| Easy/hard question lists | `topQ`, `worstQ` | `question_analysis/{unitId}` | Sort by question accuracy | Unit only | No | Yes if support >= k | For student report, show difficult questions without raw low-support values. |
| Action suggestions | `generateActionSuggestions` | Derived in React | Very hard questions plus strong correlations | Unit only | No direct PII | Yes if support >= k | Public version should avoid alarmist wording. |

### Unit Summary Pills

| Display | UI source | Serving doc field | BigQuery source / formula | Filtered today | Contains PII | Student report safe | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Unit first attempt accuracy | `selectedUnitSummary.totals.firstAttemptAccuracy` | `unit_summaries/{unitId}.totals.firstAttemptAccuracy` | Current `AVG(first_attempt_accuracy)` across daily rows | Unit only | Aggregated uid-based metric | Yes if k >= threshold | Needs weighted recomputation from facts or aggregate numerator/denominator. |
| Unit retry improvement rate | `selectedUnitSummary.totals.retryImprovementRate` | `unit_summaries/{unitId}.totals.retryImprovementRate` | Current `AVG(retry_improvement_rate)` across daily rows | Unit only | Aggregated uid-based metric | Yes if k >= threshold | Needs weighted recomputation. |
| Unit average time | `selectedUnitSummary.totals.avgTimeSec` | `unit_summaries/{unitId}.totals.avgTimeSec` | Current `AVG(avg_time_sec)` across daily rows | Unit only | No | Yes | Needs weighted average by attempts. |
| Unit improvement priority | `selectedUnitSummary.totals.improvementPriorityScore` | `unit_summaries/{unitId}.totals.improvementPriorityScore` | `(100 - avg_accuracy) * LOG10(COUNT(*) + 10)` at daily level, then averaged | Unit only | No | Yes | Should be recomputed from all rows, not averaged across days. |

### Mistake Correlation

| Display | UI source | Serving doc field | BigQuery source / formula | Filtered today | Contains PII | Student report safe | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Support users | `pair.supportUsers` | `question_correlations/{unitId}.pairs[].supportUsers` | Count users with latest answer for both questions | Unit only | Aggregated uid count | Yes if support >= k | Current threshold is 5. |
| Co-wrong users | `pair.coWrongUsers` | `pairs[].coWrongUsers` | Count users whose latest result is wrong for both questions | Unit only | Aggregated uid count | Yes if coWrong >= k | Current threshold is 3, should be raised for public reports. |
| Wrong users A/B | `pair.wrongUsersA/B` | `pairs[].wrongUsersA/B` | Count latest wrong users per question | Unit only | Aggregated uid count | Yes if each >= k | Current threshold is 3, should be raised for public reports. |
| Conditional mistake rates | `pair.mistakeRateGivenA/B` | `pairs[].mistakeRateGivenA/B` | `co_wrong_users / wrong_users_a/b * 100` | Unit only | Aggregated uid count | Yes if denominator >= k | Good for teacher guidance; public wording should be gentle. |
| Lift | `pair.lift` | `pairs[].lift` | `P(A and B wrong) / (P(A wrong) * P(B wrong))` | Unit only | Aggregated uid count | Maybe | Useful but may be too technical for student reports. |
| Phi | `pair.phi` | `pairs[].phi` | Phi coefficient on latest wrong/correct flags | Unit only | Aggregated uid count | Maybe | Admin-facing. Public report can omit. |

## Known Accuracy Risks

| Risk | Impact | Fix stage |
| --- | --- | --- |
| Admin attempt deletion does not emit `ATTEMPT_DELETED`. | Deleted attempts can remain in BigQuery-derived analytics. | Stage 2 |
| Full reset does not emit `ALL_DATA_RESET`. | Analytics can include pre-reset attempts. | Stage 2 |
| Unit summary `uniqueUsers` is `SUM(unique_users)` over daily rows. | Users active on multiple days are over-counted. | Stage 3 |
| Unit average time and improvement metrics average daily averages. | Low-volume days receive the same weight as high-volume days. | Stage 3 |
| Subject/category filters only filter unit summaries in React. | Overview totals and rankings can appear filtered while still global. | Stage 3 |
| Question analysis ranking sidebar uses global rankings. | A selected unit can show unrelated global student rankings. | Stage 3 |
| Public/student report requirements are not modeled in serving docs. | Hard to guarantee k-anonymity and no PII leakage. | Stage 4/5 |

## Target Serving Model

### Admin-only

Keep under `analytics_serving/current`.

| Path | Purpose | PII |
| --- | --- | --- |
| `overview/current` | Global admin overview and global rankings | Yes in rankings |
| `overview_by_subject/{subjectKey}` | Subject-filtered admin overview and rankings | Yes in rankings |
| `overview_by_category/{categoryKey}` | Category-filtered admin overview and rankings | Yes in rankings |
| `unit_summaries/{unitId}` | Unit-level aggregate metrics | No direct PII |
| `question_analysis/{unitId}` | Question-level aggregate metrics | No direct PII |
| `question_correlations/{unitId}` | Question pair co-mistake aggregates | No direct PII |
| `unit_rankings/{unitId}` | Unit-specific admin rankings | Yes |

### Report-safe

Generate separately under `public_analytics_serving/current`, but keep write access restricted to server/admin. The report export UI will be admin-only.

| Path | Purpose | PII policy |
| --- | --- | --- |
| `report_overview/current` | Global report summary | No uid/userName/email |
| `report_by_subject/{subjectKey}` | Subject report summary | No uid/userName/email |
| `report_by_category/{categoryKey}` | Category report summary | No uid/userName/email |
| `report_units/{unitId}` | Unit report summary | Only emitted when unique users >= k |
| `report_questions/{unitId}` | Question report detail | Only emitted when support >= k |
| `report_trends/current` | Last 7/30 day class trends | Only aggregated values |

Recommended k-anonymity defaults:

- `unitMinUsers`: 5 for admin-visible report preview, 10 for broad student distribution
- `questionMinAttempts`: 10
- `questionMinUsers`: 5
- `correlationMinSupportUsers`: 10
- `correlationMinCoWrongUsers`: 5

## Additional Metrics To Add

These can be calculated from the existing `analytics_events.questionResults` data without changing the exercise-result database structure.

| Metric | Source | Formula | Admin use | Report use |
| --- | --- | --- | --- | --- |
| First attempt accuracy | `fact_attempt_question_results` | First uid/unit/question answer accuracy | Identify initial understanding | Show "first try success rate" if k-safe |
| Retry improvement rate | `fact_attempt_question_results` | Retry accuracy minus first accuracy | Measure learning recovery | Show improvement trend if k-safe |
| Question stumble rate | `agg_question_daily` | `100 - accuracy` | Find weak questions | Show "review priority" if k-safe |
| Unit improvement priority | Facts or unit aggregate | `(100 - accuracy) * log10(attempts + 10)` | Prioritize teacher intervention | Show top review units |
| Co-mistake pairs | `agg_question_pair_current` | Latest-state co-wrong counts and rates | Find conceptual links | Show only high-support pairs, no phi needed |
| Last 7/30 day attempts | `fact_attempts` | Date-window counts | Activity tracking | Class trend card |
| Last 7/30 day accuracy | `fact_attempts` | Windowed `correct / answered` | Recent progress | Class trend card |
| Low accuracy high attempt units | `fact_attempts` | Accuracy below threshold and attempts above threshold | Intervention queue | Public "review recommended" list without student names |

## Implementation Order

1. Emit deletion/reset analytics events so BigQuery facts can match admin operations.
2. Recompute unit summaries directly from facts or carry aggregate numerators/denominators to avoid averaging daily averages.
3. Add filtered admin serving docs: `overview_by_subject`, `overview_by_category`, `unit_rankings`. Implemented with bulk scoped SQL for subject/category overviews.
4. Add report-safe serving docs under `public_analytics_serving/current` with k-anonymity thresholds. Implemented.
5. Add admin-only report preview/export UI that reads report-safe docs and prints/PDFs them. Implemented.
6. Add tests for rules, event builders, and pure aggregation/report transformation helpers.
