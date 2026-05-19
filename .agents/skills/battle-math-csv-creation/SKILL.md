---
name: battle-math-csv-creation
description: Create battle-mode math problem CSVs for Formix from a source PDF or worksheet. Use when the user provides a math PDF and asks to select, supplement, generate, or prepare about 100 quick-answer battle problems, especially for the 対戦モード / 数学対戦 import flow. Produces CSV compatible with the existing admin import format and must validate mathematical correctness, answer indexes, choices, and battle suitability.
---

# Battle Math CSV Creation

Use this skill to turn a source PDF into a battle-mode math CSV for Formix.

The goal is not to copy every problem. Build a curated set of about 100 questions that are fair for real-time 2-4 player battles:

- quick to understand
- answerable by choice selection
- mostly solvable in 10-30 seconds
- not dominated by reading speed, long diagrams, or multi-step proof
- accurate, unambiguous, and compatible with the existing CSV importer

## Output Contract

Create a CSV with the existing Formix admin import columns only:

```csv
unit_id,category,question_text,options,answer_index,explanation,image_url
```

Do not add `mode`, `subject`, or `play_mode` columns. Battle/solo selection is handled in the admin UI by choosing `数学対戦` or another battle subject.

Save battle-mode CSVs under:

```text
data/csv/battle/<category>/<unit_id>.csv
```

Do not save battle-mode CSVs directly under `data/csv/<category>/`, because that location is used by existing normal-mode CSV assets. If a target folder does not exist, create it. If the user has not specified `unit_id`, ask what `unit_id` to use before creating the CSV.

For every row:

- `unit_id`: one stable unit id for the generated set unless the user asks for multiple units. Use the same value for the output filename.
- `category`: category inferred from the PDF or requested by the user.
- `question_text`: concise Japanese problem text. Use LaTeX delimiters for math expressions.
- `options`: JSON array string with exactly 4 choices.
- `answer_index`: 1-based index of the correct option.
- `explanation`: short, objective explanation of the fastest reliable route.
- `image_url`: empty unless an image is essential and has been extracted to a public path.

## Workflow

1. Inspect the PDF.
   - Extract text and identify topic, grade, unit, and problem types.
   - If diagrams are essential, use the `pdf-to-math-csv` image extraction approach and keep only diagrams that remain readable in battle.

2. Select battle-suitable source problems.
   - Prefer short arithmetic, equation solving, simplification, substitution, sign, ratio, percentage, function-value, and quick geometry facts.
   - Avoid long word problems, proof, construction, heavy diagrams, and problems requiring lengthy written reasoning.
   - Read `references/battle-selection-rules.md` before deciding what to keep or transform.

3. Supplement to about 100 problems.
   - If the PDF has fewer than 100 suitable items, generate similar variants from the same concepts.
   - Vary coefficients, signs, constants, and distractor patterns.
   - Preserve the same grade/unit scope. Do not introduce concepts not supported by the PDF unless the user explicitly asks.

4. Generate choices.
   - Exactly 4 options.
   - Include one correct answer and three plausible distractors based on common mistakes.
   - Avoid duplicate mathematical values even if written differently.
   - Randomize the correct answer position across rows; do not always use the same index.

5. Validate.
   - Solve every generated question independently.
   - Confirm `answer_index` points to the correct option.
   - Confirm explanations match the answer.
   - Run the existing CSV validator when a file is written:

```bash
python .agents/skills/pdf-to-math-csv/scripts/validate_csv.py <csv-path>
```
   - After the format validator passes, automatically continue into the same review scope as `math-csv-check`: mathematical correctness, equivalent duplicate choices, answer index consistency, LaTeX/CSV escaping, notation quality, and explanation consistency. Do not treat CSV creation as complete until this review has been performed or a blocker is reported.

6. Report.
   - State the output CSV path.
   - Summarize counts by category/problem type.
   - List any source-PDF limitations or generated supplementation choices.
   - Mention both format validation and math-csv-check-style validation results, including any rows that need human review.

## Quality Rules

Load `references/battle-selection-rules.md` when creating, selecting, or rejecting problems.

Also use the repo skills when relevant:

- Use `pdf-to-math-csv` if image extraction or PDF-to-CSV mechanics are needed.
- Use `math-csv-check` after generation for mathematical and format consistency. This is not optional for generated battle CSVs.

## Battle-Specific Guardrails

- Target 100 rows by default. Accept 80-120 only if the source scope makes 100 artificial.
- Keep the median expected solution time around 15-20 seconds.
- Keep difficult outliers rare; a battle set should not contain surprise proof or long-reading questions.
- Prefer no `image_url`. Use images only when the visual is the mathematical object and cannot be rewritten clearly.
- Do not include AI process notes, uncertainty, apologies, or meta commentary in `question_text` or `explanation`.
- Do not overwrite existing CSVs without checking the target path and preserving unrelated user files.
