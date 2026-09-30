# 分析データの読み方

保存先は `.local/written-answers/`。`catalog.jsonl` と各 `record.json`・画像が正本、`analysis.sqlite` は結合用の再生成可能な索引。まず `archive-health.json` の `checkedAt`、`counts`、`missingMetadata` を確認する。`status=ok` は原本・SQLiteの整合性を意味し、採点やタグの正しさは意味しない。

## テーブル

| テーブル | 主なキー・用途 |
| --- | --- |
| `attempts` | `attempt_id`、`learner_key`、`attempt_group_key`、`unit_id`、`question_id`、`lesson_session_id`、`class_key`、`instruction_version`、`attempt_ordinal`、`submitted_at`、`question_version`、`rubric_version`、`grading_version`、画像相対パスとSHA-256 |
| `lessons` | 授業回ID・匿名クラス・指導内容版の組。古い答案では欠損し得る |
| `criterion_scores` | 答案IDと観点番号、得点・満点・講評。同じ観点番号でも採点版が変われば直接比較しない |
| `feedback_items` | 改善点の原文。`target_tag` と `reveals_answer` は未入力もあり得る |
| `feedback_targets` | 原文のキーワードから仮付けした対象タグ、抽出版、信頼度、人手確認状態。未登録は「指摘なし」を意味しない |
| `observations` | 答案の独立した誤り・表記タグ、`present/absent/uncertain`、根拠、抽出版、信頼度、人手確認状態。自動抽出対象は現時点で一部設問のみ |
| `exposures` | 講評または模範解答が結果画面内に表示された時刻。読了・理解・実際の注意の証拠ではない |

## 比較の作り方

1. 同じ `attempt_group_key` の1回目と2回目を、`attempt_ordinal` と提出時刻で結ぶ。問題版・採点版の一致を確認する。1グループに同じ順序の重複があれば除外して点検する。
2. 観点ごとに、初回で誤りがあった人数、再提出人数、2回目で改善した人数、残存人数を別々に集計する。`observations` の未登録は `absent` として数えない。画像で読取不能なら `uncertain` を使う。
3. 1回目の講評がその観点を実際に指摘したかを本文と `feedback_targets` で確認する。`feedback_targets.review_status=pending` は候補に留める。正解の開示有無は `feedback_items` の空欄を推測で埋めず、必要なら原文から別途判定する。
4. 1回目の講評表示時刻・模範解答表示時刻と2回目の提出時刻を比較する。両方の表示と改善があるときは両者を区別できない。表示記録がない旧答案は「曝露不明」として分ける。
5. 得点平均だけでなく分布、観点別の変化、同じ誤りが残る事例、正答に至る複数の妥当な解法、書き起こしと画像の不一致も点検する。採点版が異なる場合は得点差の解釈を控える。

## 授業改善に落とす基準

- **初回説明の候補**: 初回に同じ誤りが広く見られ、再提出時に解消する。ただし講評や模範解答が効いたと断定せず、初回授業で短い例・反例・確認問題として試す。
- **再指導の候補**: 関連する指摘があった再提出者でも誤りが残る。説明を追加するだけでなく、途中式のどこで理解が切れるかを画像で確認する。
- **測定上の候補**: 画像と書き起こしの不一致、採点版変更、授業回情報の欠損、提出ペア不足は結論の信頼度を下げる。指導改善と採点精度の問題を混ぜない。

結果は教師が次時に試せる行動、確認したい観察可能な指標、再評価する時点まで具体化する。過去のタグ定義を変える場合は抽出版を上げ、旧版の行を黙って上書きしない。
