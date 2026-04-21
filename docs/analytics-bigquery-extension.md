# Analytics BigQuery Setup

## 方針

- 管理画面の分析は `analytics_serving` のみを読む
- `users/*/attempts` や `units/*/stats` を管理画面から直接走査しない
- BigQuery の raw には必要最小限の学習イベントだけを保持する
- 問題文や表示名は `analytics_serving` へ書き戻す時に補完する

## Extension 設定値

Firebase Extension `Stream Firestore to BigQuery` は次の値で固定します。

- Collection path: `analytics_events`
- Dataset ID: `analytics`
- Table ID prefix: `analytics_events`
- BigQuery dataset location: `asia-northeast1`
- Time partitioning option type: `DAY`
- Time partitioning column name: `occurredAt`
- Firestore document field name for partitioning: `occurredAt`
- Time partitioning schema field type: `TIMESTAMP`

## BigQuery 保持ポリシー

- raw retention: `366 days`
- curated / aggregate retention: `366 days`
- raw で保持する主項目:
  - `uid`
  - `unitId`
  - `unitTitle`
  - `subject`
  - `category`
  - `score`
  - `timeSec`
  - `xpGain`
  - `correctCount`
  - `answeredCount`
  - `questionResults.questionId`
  - `questionResults.questionOrder`
  - `questionResults.isCorrect`
- raw で保持しない項目:
  - email address
  - 問題文本文
  - 管理者 email

## Firestore serving path

管理画面用の配信先は次で統一します。

- `analytics_serving/current/overview/current`
- `analytics_serving/current/unit_summaries/{unitId}`
- `analytics_serving/current/question_analysis/{unitId}`
- `analytics_serving/current/question_correlations/{unitId}`
- `analytics_serving/current/manifest/current`
- `analytics_serving/current/job_status/daily`

## functions config

集計 Functions で使う config は次で固定します。

```bash
firebase functions:config:set analytics.project_id="math-app-26c77" analytics.dataset_id="analytics" analytics.location="asia-northeast1" analytics.source_table_prefix="analytics_events" analytics.timezone="Asia/Tokyo" analytics.serving_root="analytics_serving/current"
```

## 期待する BigQuery テーブル

- `analytics.analytics_events_raw_changelog`
- `analytics.analytics_events_raw_latest`
- `analytics.fact_attempts`
- `analytics.fact_attempt_question_results`
- `analytics.agg_unit_daily`
- `analytics.agg_question_daily`
- `analytics.agg_question_pair_current`

## 初回確認

1. Extension を導入する
2. `analytics_events` にイベントが入ることを確認する
3. BigQuery に raw テーブルができることを確認する
4. 日次集計を一度手動実行する
5. `analytics_serving/current/...` に配信用ドキュメントが出ることを確認する
6. 管理画面の分析タブで overview / question_analysis / question_correlations が表示されることを確認する
