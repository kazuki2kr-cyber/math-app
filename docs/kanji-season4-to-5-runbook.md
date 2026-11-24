# 漢字 Season 4 終了・Season 5 開始手順

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
