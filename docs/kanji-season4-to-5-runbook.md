# 漢字 Season 4 終了・Season 5 開始手順

## 実施結果（2026-11-24）

Season 4 の本番アーカイブ、バッジ付与、Season 5 の初期化は完了。`leaderboards/kanjiSeason4.resetCompletedAt`（`2026-11-24T08:16:44.862Z`）を記録済みのため、同じ保存・初期化処理を再実行しない。

- [PR #15](https://github.com/kazuki2kr-cyber/math-app/pull/15) を main に反映し、Quality ワークフロー通過後に Vercel 本番へ反映した（`/images/kanji-season4-badge.png` の配信を確認済み）。一括リセット用 Cloud Function `adminResetAllKanjiData` は既存デプロイ済み版を使用した。
- 更新直前に本番データをバックアップし、漢字メンテナンス有効・数学メンテナンス無効・募集中の対戦ルーム 0 件を確認した。
- 40 名の Season 4 実参加者から通常演習・対戦の上位各 10 名を `leaderboards/kanjiSeason4` に保存し、Lv.400 以上の 6 名に Season 4 認証バッジ（`kanjiSeasonBadges.season4`）を付与した。
- Cloud Function `adminResetAllKanjiData` を実行し、197 名全員の漢字レベルを 1、漢字 XP・スコア・対戦 XP・勝利数を 0、単元成績を削除し、現行の `leaderboards/kanji` と `leaderboards/kanjiBattle` を空（0 件）にした。保存後および初期化後の検証で、未初期化ユーザーと未付与バッジはともに 0 件。
- Season 1（33 名）・Season 2（20 名）・Season 3（13 名）のアーカイブと既存バッジ数、漢字利用認証（47 名）、数学データ（数学 XP 保有 182 名）、対戦の試合履歴（`kanji_battle_results` 330 件）は更新前後で一致した。
- 既存の漢字単元 6 件（`3級第6回`〜`3級第11回`）は保持したまま、漢字メンテナンスは有効、数学は通常稼働のままとしている。管理画面から Season 5 用の問題入れ替えを行った後、`docs/kanji-all-random-pool.md` に従って全単元対戦プール（`node scripts/build-kanji-battle-pool.js --apply`）を再作成し、漢字メンテナンスを解除して利用を再開する。

以下は次回の切替に流用するための手順記録。今回の Season 4 処理には再使用しない。

## 確定した仕様

- Season 4 の認証条件は漢字 Lv.400 以上。認証画像は `public/images/kanji-season4-badge.png`。
- 通常演習の獲得XP上位10名と、対戦XP上位10名を `leaderboards/kanjiSeason4` に保存する。
- 保存した順位は漢字トップと対戦トップで、過去シーズンを選ぶ形で表示する。
- Season 5 の開始値は全員が漢字 Lv.1・0 XP。漢字の単元成績、スコア、対戦XP、勝利数と現行ランキングも初期化する。
- Season 1〜4 のバッジと記録、数学データ、漢字利用認証、対戦の試合履歴、既存の漢字単元（6単元）は保持する。
- 一括リセットは Cloud Function `adminResetAllKanjiData`（`functions/src/adminActions.ts`、400名単位バッチ＋`resetCompletedAt` 冪等制御）で実行する。

## 実施順序

1. 切替日時を決め、漢字演習と新規対戦を停止する（`config/maintenance_kanji.enabled === true`、数学 `config/maintenance.enabled === false`）。進行中・募集中の対戦がないことを確認する。
2. 本番の `users`、`leaderboards/kanji`、`leaderboards/kanjiBattle`、過去シーズンのアーカイブをバックアップし、保存済み Season 1〜3 を照合する。
3. 品質チェックに通った本変更を本番へ反映する。更新後の管理画面が「Season 4を保存」と表示し、バッジ画像 `public/images/kanji-season4-badge.png` が配信されることを確認する。
4. 管理画面または運用スクリプトで「Season 4を保存」を一度実行する。通常・対戦の上位10名、認証対象人数、実際のバッジ付与を確認する。既存の `kanjiSeason4` がある場合は上書きしない。
5. `adminResetAllKanjiData`（「保存済み記録を確認して一括リセット」）を実行する。`resetCompletedAt` が記録されたら再実行しない。
6. 全ユーザーの漢字XP・レベル・対戦成績と現行ランキング、過去順位、認証バッジ、試合履歴保持を確認する。
7. 終了後は漢字メンテナンスを有効のまま維持し、管理画面から Season 5 用の漢字問題入れ替えを行った後、`docs/kanji-all-random-pool.md` に従って全単元対戦プールを再作成し、漢字メンテナンスを解除して利用を再開する。
