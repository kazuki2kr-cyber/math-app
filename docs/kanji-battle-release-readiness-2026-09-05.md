# 漢字対戦刷新：実装・検証と本番切替メモ

本番未反映。push、Firebase deploy、Vercel deploy、実データの移行は行っていない。
設計経緯は `kanji-battle-renewal-plan-2026-09-05.md` を参照。同計画書末尾の「変更は計画書のみ」は調査時点の記録であり、現在の実装状況は本書を正とする。

## 実装した内容

- 問題間の待機をサーバー管理の3秒に統一。待機・開始前・時刻未同期・締切後は問題と入力欄を隠し、送信も禁止。
- RTDBの時刻差と単調時計で画面時計を補正。回答時間はFunctionへの到着時刻で確定し、クライアントの時間指定は採用しない。開始前送信は拒否し、負の時間を0秒に丸めない。
- 作成・入室・準備・開始・退出・回答をFunction化。同じルームのトランザクションで定員4人と開始条件を検査。旧クライアントの直接書き込みもルールで拒否。
- 「ルームを作る」「ルームに参加」の2択へ変更。ホスト名・単元名・現在人数を表示する一覧から選択。従来の自動マッチング・番号入力参加を撤去。
- 一覧はサーバーの要約投影。新しい順に30件ずつ取得枠を拡大し、満員・開始済み・解散済み・期限切れを除外。入室時には一覧表示と無関係に正本を再検査。
- 複数タブ対応の接続記録と15秒の切断猶予。問題進行と退出判定はCloud Tasksでも実行するため、特定ホストのブラウザだけに依存しない。
- 全10問の手書き画像を一括OCRへ引き継ぐ。サーバー確定済みの回答時間だけを採点に使用。漢字対戦の既存結果確定にあったAdmin SDKの時刻定数参照エラーも修正。
- 結果確定は参加者から再試行でき、既存のFirestoreトランザクションでXP・結果の二重反映を防止。

## 検証コマンド

```powershell
npm.cmd run test:kanji-battle
npm.cmd run test:kanji-battle:e2e
npx.cmd jest tests/unit --runInBand
npm.cmd run test:security
npm.cmd run build
npm.cmd run check:mojibake
git diff --check
```

漢字専用スクリプトはFunctionsをビルドしてからAuth・Firestore・RTDB・Functions Emulatorを起動し、終了後に停止する。通常のJestとは別実行とし、既存の全Firestore消去テストと競合させない。

確認済み：

- 単体テスト12スイート・180件成功（漢字状態遷移7件を含む）。
- Firestoreセキュリティテスト37件成功。既存の週次スナップショットテスト7件も成功。
- 漢字専用テスト3スイート・13件成功（状態遷移7件を含む）：同時入室、定員・本人以外の権限、開始と退出の競合、開始前送信拒否、10問のサーバー時間、二重送信、複数タブと切断猶予、OCR採点・結果・XPの冪等性、古い一覧イベントの再配信。
- Chromium E2E 1件成功。ホストの時計を+24秒、ゲストを-60秒に設定し、一覧参加→準備→開始→10問→結果確定まで実行。ゲストは390×844のモバイル幅。待機中の問題非表示、10問すべてのOCR送信用画像に筆跡が残ることを検査。
- 本番用Next.jsビルド、Functionsビルド、対象フロントファイルのESLint、文字化け検査、差分空白検査が成功。

## 検証の境界

- 有料のVision APIは呼んでいない。ブラウザE2EではOCR callableのみを代替。別の統合テストではVision応答のみを代替し、実際のOCRレイアウト解析・採点・RTDB保存・Firestore結果とXP確定を通した。
- Emulatorでは時間制御用のタスクを明示的に実行する。Cloud Tasksの本番配信・IAM・遅延・再試行は本番設定での確認が必要。ネットワークやコールドスタートにより、3秒の期限を過ぎて画面切替が届くことはあり得るが、次問の30秒はサーバーが次問を開いた時点から確保する。
- Safari/iOS実機、実ネットワーク切断からのブラウザ復帰、大量ルームの一覧ページングは未実機検証。複数接続・猶予・古い状態バージョンはバックエンド統合テストで検査。
- 一覧要約の読み取りはアプリ利用権を持つユーザーに許可。実際の入室・操作にはさらにFirestoreの漢字利用権を必須とする。ルーム本体は参加者／管理者のみ参照可能。
- 既存の数学モード・Firestoreルールは変更しない。依存パッケージとpackage versionも変更していない。AGENTS.md末尾はNext.js開発サーバーによる自動追記。

## 本番切替（未実行）

1. 更新対象の差分を確認し、旧クライアントの新規対戦利用を止められるメンテナンス時間を確保する。進行中の旧ルームを終了させる。既存結果は削除しない。
2. Firebase CLIの本番認証・対象プロジェクト `math-app-26c77` を確認。Cloud Tasks API、キュー作成権限、実行サービスアカウントのenqueue／認証トークン発行／タスク関数呼び出し権限を確認する。権限付与は今回未実行。
3. 新しいタスクFunction `kanjiBattleDeadline` とキューを先に配置し、次にCallable群とRTDBトリガーを配置する。リージョンは `us-central1`、RTDBトリガーは `math-app-26c77-default-rtdb` を対象とする。
4. 更新対象Functions：`createKanjiBattleRoom`、`joinKanjiBattleRoom`、`leaveKanjiBattleRoom`、`readyKanjiBattleRoom`、`startKanjiBattleRoom`、`advanceKanjiBattleRoom`、`submitKanjiBattleAnswer`、`kanjiBattleDeadline`、`syncKanjiBattleRoom`、`getKanjiBattleQuestions`、`submitKanjiBattleOcr`、`finalizeKanjiBattleRoom`、`cleanupRetentionData`。
5. `database.rules.json` とフロントを同じメンテナンス枠で反映する。Firestoreルール／インデックス変更は不要。mainへのpushでVercel本番デプロイが動くため、承認前にpushしない。
6. 全クライアントを再読み込みし、新しいルームを作成する。旧ルームでは新規対戦しない。旧画面への新ルール反映は互換ではなく、旧画面の直接DB操作は拒否される。
7. 公開再開前に2〜4人の実対戦、5人目拒否、ホスト切断時のタスク進行、実Vision採点、順位・XP・ランキング反映、一覧から閉じた部屋が消えることを確認する。Cloud Tasksとトリガーのエラーログを確認する。

ロールバック時も、まず新規対戦を止める。フロントだけ旧版へ戻すと新ルールと互換にならない。広い直接書き込み許可を復活させることは不正操作経路を再開するため避け、安全な停止状態を維持して修正版を配置する。対戦結果とXPは削除・巻き戻ししない。
