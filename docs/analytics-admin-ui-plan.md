# Analytics Admin UI Plan

## 結論

管理画面の分析は BigQuery で事前計算した `analytics_serving` だけを読む構成に一本化します。  
これにより、管理画面から `collectionGroup('attempts')` や `collectionGroup('stats')` を叩いていた従来方式をやめ、読み取りコストの急増を防ぎます。

## 現行 Firestore 構造のままで出せる指標

次は既存の operational Firestore 構造を変えずに出せます。  
必要なのは `analytics_events` と BigQuery 集計だけです。

### 優先度A

- 総 attempt 数
- ユニーク生徒数
- 平均正答率
- 単元別正答率
- カテゴリ別正答率
- 問題別正答率
- hardest / easiest questions
- 問題間相関
- DAU / WAU / MAU
- 総学習時間
- 1人あたり平均 attempt 数

### 優先度B

- 初回正答率
- 再挑戦改善率
- 平均解答時間
- 改善優先度スコア
- 要注意人数
- 問題の識別力近似

### 条件付き

- 忘却リスク指数
- コホート継続率
- 単元遷移分析

上の 3 つは計算自体は可能ですが、学校運用で見るべきかを確認しながら段階導入で十分です。

## 無料枠を意識した採用判断

170名規模では、次を優先しても BigQuery 無料枠に収まる可能性が高いです。

- overview KPI
- 単元別 / 問題別集計
- 初回正答率
- 再挑戦改善率
- 相関上位ペア

一方で次は「必要になったら」でよいです。

- 全問題ペアの常時計算
- 長期の高頻度 cohort 再集計
- 管理画面からの ad hoc SQL 前提の深掘り表示

## 管理画面タブ構成

### 1. 概要

- 総 attempt 数
- 平均正答率
- DAU / WAU / MAU
- 総学習時間
- 初回正答率
- 再挑戦改善率
- 要注意人数
- 単元別ランキング
- カテゴリ別正答率

### 2. 問題分析

- 単元選択
- 問題別正答率
- 難易度分布
- hardest / easiest questions
- 改善アクション提案
- 初回正答率
- 再挑戦改善率
- 平均時間
- 改善優先度

### 3. 相関分析

- 単元選択
- 相関の強い問題ペア
- サポート人数
- 集計更新時刻

## 採用しない方針

- 管理画面から raw Firestore を直接集計しない
- `attempts` / `stats` / `questions` の collectionGroup を分析のために叩かない
- BigQuery raw に問題文や email を保存しない

## 実装メモ

- 管理画面は `analytics_serving/current/...` を参照する
- 相関分析は precomputed pair のみ表示する
- BigQuery の raw は最小イベントだけを保持する
- 問題文は serving 書き戻し時に補完する
