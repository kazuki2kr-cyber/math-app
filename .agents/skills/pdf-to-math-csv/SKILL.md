---
description: PDFから数学問題のCSVデータを生成し、画像を抽出・保存する（テキスト最適化対応版）
---

# `pdf-to-math-csv` スキル

ユーザーが「PDFから問題を抽出してCSVにして」「このPDFを問題データに変換して」と依頼してきた場合に、このスキルを起動してください。

## ワークフロー

### 1. PDFの読み込みと画像の抽出
ユーザーから提供されたPDFを受け取ったら、まずその中に問題として必要な画像（図形やグラフなど）が含まれているか確認します。
必要な画像が含まれている場合、以下のPythonスクリプトを実行してPDFから画像を抽出・保存します。

**実行するコマンドの例:**
```bash
python .agents/skills/pdf-to-math-csv/scripts/extract_images.py <PDFの絶対パス> public/images/units/<unit_id>
```

- `<unit_id>` はユーザーから指定された単元ID、もしくはPDF名などから推測して作成するディレクトリ名を利用します（確認してください）。
- スクリプト実行後に出力された画像のファイルパス（例: `public/images/units/xxx/image_p1_1.png`）を記録し、対応する問題の `image_url` に紐づくよう準備します。
- CSV上の `image_url` には公開パス（例: `/images/units/xxx/image_p1_1.png`）として記述します。

### 2. 問題・解答・解説データの抽出と「最適化」
PDFのテキストを読み込み、データを抽出します。ただし、**ただそのまま抽出するのではなく、以下の【テキスト最適化のルール】に従って高品質なデータに編集・成形してください。**

**【テキスト最適化のルール】**
- **問題文の推敲:** 生のPDFテキストにある不自然な改行やOCRの誤字、不要なヘッダ/フッタ、`[cite: ...]` や `【出典】` といった不要な引用記号を**すべて除去**し、学習者が自然に読めるわかりやすい日本語の問題文にリライトしてください。
- **解説文章の充実:** PDFにある解説が簡素すぎたり不親切な場合は、学習者が理解しやすいように段階を踏んだ、丁寧な解説文に加筆・最適化してください。
- **50問のバランス抽出（問題タイプの網羅）と類題生成:** 指定されたPDFから問題をランダムに選び出し、**全50問**になるように抽出してください。
  - **重要: 問題数が不足する場合**：PDF内の問題だけでは50問に満たない場合は、既存の問題の数値を変えたり、同等の難易度・パターンの**類題（類似問題）をAIが自ら作成**し、必ず計50問になるように調整してください。
  **【重要】単なる計算問題に偏らないよう、以下の様々なタイプの問題を必ずバランスよく含めて抽出してください。**
  1. **計算問題:** 整数・小数・分数、加減乗除など様々なパターンを含める。
  2. **意味・概念を問う文章題:** （例：「北へ5kmを+5kmと表すとき...」「250円の支出を...」など、言葉の定義や性質を問うもの）
  3. **用語・性質問題:** （例：絶対値の定義や、数の大小比較など）
  4. **図表・数直線問題:** 抽出した画像を用いるか、数直線の目盛りを読むような問題。
- **ダミー選択肢（誤答肢）の高精度な生成:** 正解以外の3つの選択肢は、「正解の末尾に単に数字を足しただけ（例: 絶対値1, 絶対値2）」のような不自然なものを**絶対に生成しないでください**。学習者が間違えやすい計算ミス、符号のミス、意味の似た用語（例：「絶対値」のダミーとして「相対値」「距離」「原点」など）、紛らわしい数値など、**必ず意味的に異なり、かつもっともらしい（自然な）4つの選択肢**を生成してください。
- **LaTeXフォーマットの徹底:** 数式や分数、累乗などは必ず `\\( ... \\)` の形式（デリミタ付き）でLaTeX形式に変換してください。
  - **`question_text` や `explanation`:** 文中の一部として数式が登場する場合も、**必ず** `\\( ... \\)` で囲んでください。（例: `540 を素数でわっていくと \\( 2^2 \\times 3^3 \\times 5 \\) になります。`）このようにしないとフロントエンドで数式として認識されず文字化けします。
  - **バックスラッシュのエスケープについて:** Pythonの `json.dumps()` やCSV処理に任せ、手動で `.replace("\\", "\\\\")` などの過剰な二重エスケープ処理を行わないでください。手動で二重エスケープをおこなうとフロントエンドで `\\ \\frac` のように文字化け表示される原因となります。

### 3. CSVフォーマットの生成と保存
最適化されたデータを元に、math.appの管理画面からアップロードできるフォーマットのCSVを生成し、以下のルールに従ってファイルを保存します。

**【保存先のルール】**
- **ディレクトリ**: `data/csv/<category>/`
- **ファイル名**: `<unit_id>.csv`
  - 例: `data/csv/1.正の数と負の数/1.正負の数の加減.csv`

**【重要：データの品質と正確性の保証】**
- **AIの独白や思考プロセスの混入禁止**:
  - `explanation` や `question_text` に、AI自身の試行錯誤や検算、訂正のプロセス（例:「あれ？」「すみません」「計算し直します」等）を**絶対に含めないでください**。
  - 解説文は、学習者に対して常に「正解への最短経路」を客観的かつ丁寧に解説する形式に徹してください。
- **最終バリデーションの義務化**:
  - CSVを出力・提供する前に、必ず以下の3点について**再検算と整合性チェック**を行ってください。
    1. **問題と正解の整合性**: 問題を解き直し、正解が `answer_index` で指定した選択肢と一致しているか。
    2. **選択肢の重複と質の確認**: 同じ内容の選択肢がないか、また選択肢の質が最適化ルールに沿っているか。
    3. **データの重複削除**: 生成スクリプト等の不備で、同じ問題や修正前のデータが重複して登録されていないか。
- **数式精度の再確認**: 全ての数式が適切に `\\( ... \\)` で囲まれ、符号（マイナスとダッシュの混同等）が正しいか。

**CSVヘッダー:**
`unit_id,category,question_text,options,answer_index,explanation,image_url`

**【CSVカラムの詳細と制約】**
- **`unit_id`**: 提供されたPDFのファイル名（拡張子 `.pdf` を除いたもの）をそのまま使用してください（例: `1.正負の数の加減.pdf` なら `1.正負の数の加減`）。
- **`category`**: 単元のカテゴリ名（例: `1.正の数と負の数`）。PDFの内容や単元名から判断して入力してください。
- **`question_text`**: 最適化された問題文。改行が含まれる場合は全体をダブルクォーテーションで囲むこと。数式エスケープのバックスラッシュは1つ（`\\`）。
- **`options`**: 選択肢の配列。**必ず正しいJSON配列の文字列フォーマット**で記述すること（例: `["選択肢1", "選択肢2", "選択肢3", "選択肢4"]`）。数式エスケープがあれば2つ（`\\\\`）。
  - ※CSVの仕様上、JSON文字列全体をダブルクォーテーションで囲み、内部のダブルクォーテーションを2つ重ねてエスケープする必要があります。
  - 出力例: `"[""A"", ""B"", ""C"", ""D""]"`
- **`answer_index`**: 正解の選択肢のインデックス（**1始まり**）。4択の場合は 1〜4。
- **`explanation`**: 最適化された解説文。
- **`image_url`**: 図表が必要な問題は、スクリプトで抽出・推測された画像のパス（例: `/images/units/xxx/image_p1_1.png`）。画像がない場合は空欄のままとする。

**注意事項:**
- JSONのパースエラー（例えば `t.options?.map is not a function`）を防ぐため、`options` のJSON配列化は厳格に行ってください。
- 最終的なCSVデータは指定の保存先にファイルとして書き出し、ユーザーに提供するか、コードブロックで出力してください。

---

## 追記: 記述式イベントCSVの生成

PDFや画像、またはユーザーが提示した「問題・答え・解説」から記述式イベント問題を作る場合も、このスキルを使用できます。
ただし、既存の4択生成フローは維持し、記述式が明示された場合だけ次の追加列を使います。

```csv
unit_id,category,question_text,options,answer_index,explanation,image_url,question_type,model_answer,grading_rubric,written_attempt_limit,event_status,event_starts_at,event_ends_at
```

記述式の固定値:

- `question_type`: `written`
- `options`: `[]`
- `answer_index`: `1`
- `written_attempt_limit`: 原則 `1`
- `event_status`: 未指定なら `active`

### 問題・答え・解説から作る場合

1. `question_text` は、学習者がそのまま解ける自然な日本語に整える。
2. `model_answer` は、Gemini採点用に途中式、最終答、許容表記、部分点条件を含める。
3. `grading_rubric` は、合計100点相当のJSON配列文字列にする。原則は **過程・記述60点、最終答・結論40点** とし、最終答だけで高得点にしない。
4. `explanation` は、元資料の逐語コピーを避け、学習者向けに短く再説明する。
5. 同じ `unit_id` に記述式問題を複数入れない。

採点API側では答案画像の読み取り結果を `transcription` として保存します。CSV作成時の `model_answer` と `grading_rubric` は問題固有の数学的基準に絞り、OCR・文字起こし・画像品質に関する共通指示は書き込まないでください。

### 記述式ルーブリックの厳格化

記述式問題では、正答値だけでなく答案としての説明力を採点します。採点者が行間を好意的に補う前提にせず、答案に書かれた内容だけで判断できるルーブリックにします。

- 過程・記述: 合計60点。条件設定、変数定義、公式・立式、途中計算、証明の根拠、表現の明確さを含める。
- 最終答・結論: 合計40点。問いに対応した正しい答え、必要な単位・対象・結論文を含める。

共通の上限制御:

- 最終答・結論が誤っている場合は、過程が良くても原則60点まで。
- 答えだけ正しく、途中式・説明・証明がほぼない場合は原則40点まで。
- 最終答が正しく、過程が一部不足している場合は、40点に過程点の一部を加える。
- 最終答がない、問いに対応していない、対象が曖昧な場合は原則60点まで。
- 矛盾した計算や根拠のない公式使用で偶然正答した場合は大きく減点する。

問題タイプ別テンプレート:

- 計算・方程式型: 方針/公式20、途中計算30、表記10、最終答40。
- 文章題・立式型: 条件整理/変数定義15、立式25、計算/比較15、表現5、最終答40。
- 証明型: 仮定/条件整理15、根拠の明示20、論理の接続20、表現5、結論40。
- 図形・関数の説明型: 条件読み取り15、性質/定理の適用20、計算または推論20、表現5、結論40。

「文字を断りなく使う」「結論が数値だけ」「式の根拠が飛んでいる」答案は明確に減点できる配点にしてください。

### 著作権配慮

解説は、教材やPDFの文をそのまま写さず、独自の表現に書き換えてください。
数学的な式や最終答は必要な範囲で使えますが、説明文の構成、語尾、比喩、例示は再構成します。

### 検証

生成後は必ず次を実行します。

```bash
python .agents/skills/pdf-to-math-csv/scripts/validate_csv.py <対象CSVパス>
```
 
---

## 2026-06 update: structured written rubric CSV generation

When generating Formix written-event CSV rows, use `written_attempt_limit=2` by default and write `grading_rubric` as a structured JSON array string:

```json
[
  {
    "label": "変数の定義",
    "maxScore": 20,
    "description": "文字が何を表すかを明確に定義し、問題の対象を正しく文字式で表している。"
  }
]
```

Requirements:

- Each rubric object must include `label`, `maxScore`, and `description`.
- `maxScore` values must total exactly `100`.
- `label` should be short and stable because analytics groups by it together with `criterionIndex`.
- `description` should be concrete enough to display in the admin written analytics screen.
- Do not use a plain string array for new written-event CSVs unless preserving legacy data exactly.
- Do not include OCR, handwriting quality, unreadable-image, or transcription instructions in `model_answer` or `grading_rubric`.
- Keep one written question per `unit_id`.

Recommended rubric patterns:

- Calculation/process problem: setup or method 20, intermediate calculation 25, mathematical notation/clarity 15, final answer/conclusion 40.
- Algebra/proof problem: variable/assumption definition 20, expression setup 20, transformation/reasoning 20, conclusion 40.
- Explanation problem: target/condition organization 15, representation or theorem use 20, reasoning chain 25, expression clarity 10, conclusion 30.

Written CSV header:

```csv
unit_id,category,question_text,options,answer_index,explanation,image_url,question_type,model_answer,grading_rubric,written_attempt_limit,event_status,event_starts_at,event_ends_at
```
