# CSV Asset Layout

This directory stores CSV files used for Formix question imports.

## Current Layout

```text
data/csv/
  1.正負の数/
  2.式の計算/
  battle/
    1.正負の数/
```

## Normal Mode

Existing normal-mode CSV files live directly under category folders such as:

```text
data/csv/1.正負の数/
data/csv/2.式の計算/
```

Keep these paths for existing assets to avoid unnecessary churn.

## Battle Mode

Battle-mode CSV files must live under:

```text
data/csv/battle/<category>/<unit_id>.csv
```

When importing these files in the admin screen, choose a battle subject such as `数学対戦`.

Do not place battle-mode CSVs directly under the normal category folders.
