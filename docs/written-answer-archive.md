# 記述式答案のローカルアーカイブ

## 保存の流れ

採点 Function は答案画像と採点メタデータを Firebase Storage の `written-archive/v1/` に一時保管します。画像の SHA-256 を回答履歴にも記録し、採点確定後だけ管理者が回収できます。Storage ルールはクライアントアクセスを全面的に拒否し、Functions の管理者権限だけで読み書きします。

既存の「Formix 週次プロダクトレビュー」automation は、週次スナップショット生成前に次を実行します。

```powershell
npm.cmd run archive:written:pull
```

回収プログラムは `.env.local` の管理者テストアカウントで認証し、画像の容量と SHA-256 を検証してからローカルへ書き込みます。保存済みファイルも再検証できるので、途中失敗後の再実行は安全です。確認が済んだ答案の一時保管ファイルを削除し、最後に回収可能なクラウド残件を再照会します。残件がある場合も非ゼロ終了して週次automationに知らせます。回収途中の失敗なら一時保管ファイルは次回回収に残ります。

同じコマンドは結果画面の表示記録も回収し、原本からローカルSQLite `analysis.sqlite` を更新します。画像・`record.json`・`catalog.jsonl` が正本で、SQLiteは再生成可能な分析用索引です。ローカル原本だけで作り直すには `npm.cmd run archive:written:index` を実行します。SQLiteの構築に失敗しても、保存済み画像とJSONから再試行できます。

週次automationは回収後に `npm.cmd run archive:written:health` で原本画像・SQLiteの整合性と分析に必要な情報の充足を確認します。結果は `.local/written-answers/archive-health.json` に集計値だけを保存します。`npm.cmd run archive:written:units` は分析可能な単元の一覧を表示します。「分析をしたい」と依頼された際は `.agents/skills/written-answer-teaching-analysis/SKILL.md` に従い、対象単元と分析の深さを確認します。

## このPCの保存先

`C:\Users\ichikawa\Desktop\math.app\.local\written-answers\`。`.local/` は Git の管理対象外です。答案には個人情報が含まれ得るため、このフォルダを公開リポジトリ、一般向けの同期フォルダ、週次レビューの入力JSONへ移動しないでください。PCのディスク暗号化を有効にし、別の暗号化媒体へ定期的にバックアップしてください。

```text
.local/written-answers/
  catalog.jsonl                 # 全答案を横断して機械処理する索引
  analysis.sqlite               # ローカルの分析用SQLite
  archive-health.json           # 整合性と分析用データ充足の集計結果
  exposures/                    # 結果画面の表示記録。直接識別子は保存しない
  subject=<教科>-<hash>/
    field=<分野>-<hash>/
      unit=<単元ID>-<hash>/
        question=<問題ID>-<hash>/
          learner=<匿名キー>/
            attempt=<答案ID>-<hash>/
              answer.png        # png/jpeg/webp のいずれか
              record.json
```

フォルダ名のハッシュは、同名や使用できない文字の衝突を防ぐためのものです。正式な教科・分野・単元名は `record.json` の `subject`、`field`、`unitId`、`unitTitle` を参照してください。分野は提出時点の `units/{unitId}.archiveField` を優先し、未設定なら `category` を使います。既存の記述式イベントの `category` が「記述式問題」など広すぎる場合は、提出前に `archiveField` を「文字式」「方程式」などの数学上の分野として設定してください。カテゴリーが後から変更されても提出時点の分類を保持します。学年など既存の単元データにない分類は推測して補いません。

`record.json` は `schemaVersion`、提出・問題・単元の識別子、匿名学習者キー、提出回数、問題文、模範解答、採点基準、AI書き起こし、観点別得点、講評、画像のハッシュを含みます。氏名、メール、Firebase UID はローカルの分析用ファイルに出力しません。`catalog.jsonl` はこれらのレコードに相対パスを加えた UTF-8 JSON Lines です。書き起こしはAIの読取結果であり、原画像を照合できる形で保存します。

新しいアーカイブには、設問と採点基準のハッシュ版、採点プロンプトの版、授業回・匿名クラス・指導内容の版を追加します。授業回などは記述式CSVの `lesson_session_id`、`class_key`、`instruction_version`、または管理画面の「単元一覧 → 分析用授業情報」から単元に設定し、提出時の値を保存します。同じ単元を別クラス・別授業回で使うときは、次の提出前に管理画面で更新してください。未設定なら空欄のまま扱い、提出日からクラスを推定しません。

SQLiteは `attempts`、`lessons`、`criterion_scores`、`feedback_items`、`feedback_targets`、`observations`、`exposures` に分けています。`observations` は現在、設問 `1.1x+1.8=0.5x` について、AI書き起こしから根拠を明示できる誤り候補だけを追加します。誤りがないという判定は生成しません。改善点の文に含まれる語から `feedback_targets` も仮付けします。いずれも `pending` の人手確認待ちで、採点や生徒向けフィードバックには使いません。対象外の設問では観察行を生成せず、後から別版の分析器を追加できます。

ほかの問題に対するCodexまたは教員の観察は、`{"attemptId":"...","tag":"constant_transfer_sign_error","state":"present","evidence":"該当する式","confidence":0.8,"reviewStatus":"pending"}` のような1行1件のJSONLを `.local/` に作り、`npm.cmd run archive:written:observations -- <ファイル>` で取り込めます。`state` は `present` / `absent` / `uncertain`、`reviewStatus` は `pending` / `confirmed` / `rejected` です。入力はローカルの答案IDだけを参照し、採点・講評は変更しません。

結果画面で総評または模範解答が画面内に入った時刻を別途記録します。これは「画面内に表示された」記録であり、「読んだ・理解した」という意味ではありません。通信失敗や画面を開かない場合は記録されないことがあります。表示記録は週次回収後にクラウドから削除します。

## 運用上の境界

- この経路をデプロイする前の提出画像は、既存のFirestore回答履歴から復元できません。
- PCの停止や認証失敗で週次回収ができない間は一時保管が継続します。失敗を無視せず再実行してください。
- Firebase Storage の利用量と転送量には費用が発生し得ます。実際の画像サイズと件数を測定して見積もってください。
- 回答履歴は約90日で削除対象です。回収前に履歴が消えても小さな回収確認レコードで採点確定を照合できますが、通常は毎週回収してください。回収が遅れる間の一時保管料金は続きます。
- 週次プロダクトレビューの公開用集計には答案原文・個人別成績を含めません。答案分析は別の明示的な作業として実施します。
