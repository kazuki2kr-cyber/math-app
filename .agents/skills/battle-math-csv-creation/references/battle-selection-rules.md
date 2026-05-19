# Battle Selection Rules

Use these rules when creating Formix battle-mode math CSVs.

## Suitability Scale

Label each candidate problem internally as:

- `A`: ideal for battle. Quick recognition or short calculation.
- `B`: usable with light rewriting or simpler numbers.
- `C`: not suitable. Exclude unless the user explicitly requests it.

Only `A` and carefully transformed `B` problems should appear in the final CSV.

## Keep

Good battle questions usually have:

- one clear objective answer
- 4-choice format without ambiguity
- short text, usually 1-2 sentences
- expected solution time of 10-30 seconds
- no dependency on long reading, drawing, or written proof
- a common mistake pattern for plausible distractors

Examples of suitable types:

- positive/negative number arithmetic
- fraction and decimal arithmetic with small numbers
- simplification of simple algebraic expressions
- substitution into a formula
- solving one-step or two-step linear equations
- expanding/factoring simple expressions
- proportional reasoning with small integers
- percentage/rate basics
- reading a simple value from a table
- function value calculations such as `y = ax + b`
- angle facts that can be stated without a complex figure

## Transform With Care

These can be used after simplification:

- word problems: rewrite into short direct questions
- diagram problems: replace the diagram with text if possible
- multi-step calculations: reduce to one main idea
- large-number arithmetic: shrink coefficients while preserving concept
- textbook-style tasks: convert "show that" into "choose the correct value/expression"

## Exclude

Avoid these in battle sets:

- proofs, derivations, or "explain why" problems
- construction or drawing tasks
- long reading comprehension
- problems requiring many cases
- diagrams that are hard to read on a phone
- problems where several options are equivalent
- trick questions relying on wording rather than math
- questions where speed would mostly measure typing/reading rather than understanding

## Difficulty Mix

For about 100 questions, aim for:

- 60 easy/standard quick questions
- 30 medium questions
- 10 harder but still short questions

Do not make all questions easy. Battle needs differentiation, but the difference should come from accuracy and fluency, not obscure tricks.

## Distractor Design

Use plausible distractors:

- sign mistakes
- operation-order mistakes
- reciprocal/inverse mistakes
- dropped parentheses
- distribution errors
- wrong side movement in equations
- arithmetic slips
- confusing coefficient and constant

Avoid:

- nonsense values
- duplicate equivalent values
- "all of the above"
- "none of the above"
- distractors that are much longer or visually unlike the correct answer

## LaTeX And CSV Rules

Use LaTeX for math expressions:

- In `question_text` and `explanation`, write math as `\( ... \)`.
- In `options`, because it is JSON inside CSV, preserve valid JSON. Prefer using a CSV writer or `json.dumps` instead of manual escaping.

Examples:

```csv
unit_id,category,question_text,options,answer_index,explanation,image_url
battle_integer_001,正負の数,"次の計算をしなさい。\( -7+12 \)","[""5"",""-5"",""19"",""-19""]",1,"負の数から正の数を足すので、\(12-7=5\)。",
```

## Final Review Checklist

Before delivering the CSV, check:

- The file has about 100 rows.
- Every row has exactly 4 options.
- `answer_index` is 1-4.
- Correct options are mathematically correct.
- No duplicate choices after mathematical simplification.
- Explanations are short and match the problem.
- The set stays within the PDF's topic scope.
- No question needs a long proof or long reading.
- Generated variants are not near-duplicates.
