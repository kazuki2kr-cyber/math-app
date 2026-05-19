# -*- coding: utf-8 -*-
import csv
import json
from collections import Counter
from fractions import Fraction
from pathlib import Path

UNIT_ID = "正負の数の計算（対戦モード用）"
CATEGORY = "1.正負の数"
OUT_PATH = Path("data/csv/battle/1.正負の数/正負の数の計算（対戦モード用）.csv")

rows = []
used_questions = set()


def frac_latex(value: Fraction) -> str:
    value = Fraction(value)
    if value.denominator == 1:
        return str(value.numerator)
    sign = "-" if value < 0 else ""
    value = abs(value)
    return f"{sign}\\frac{{{value.numerator}}}{{{value.denominator}}}"


def paren(value: Fraction, force_plus: bool = False) -> str:
    value = Fraction(value)
    body = frac_latex(abs(value))
    if value < 0:
        return f"(-{body})"
    return f"(+{body})" if force_plus else body


def option_text(value: Fraction) -> str:
    return f"\\({frac_latex(value)}\\)"


def math_text(expr: str) -> str:
    return f"\\( {expr} \\)"


def explanation(answer: Fraction) -> str:
    return f"符号に注意して計算すると、答えは \\( {frac_latex(answer)} \\) です。"


def add_row(kind: str, expr: str, answer, distractors) -> None:
    answer = Fraction(answer)
    if expr in used_questions:
        return
    used_questions.add(expr)

    values = []
    for candidate in [answer, *[Fraction(v) for v in distractors]]:
        if candidate not in values:
            values.append(candidate)

    fallback_candidates = [
        -answer,
        abs(answer),
        answer + 1,
        answer - 1,
        answer + 2,
        answer - 2,
        answer + 5,
        answer - 5,
    ]
    for candidate in fallback_candidates:
        if len(values) >= 4:
            break
        if candidate not in values:
            values.append(candidate)

    if len(values) < 4:
        raise RuntimeError(f"Not enough options for {expr}")

    correct_slot = len(rows) % 4
    ordered = values[1:4]
    ordered.insert(correct_slot, answer)

    rows.append({
        "unit_id": UNIT_ID,
        "category": CATEGORY,
        "question_text": f"次の計算をしなさい。{math_text(expr)}",
        "options": json.dumps([option_text(v) for v in ordered], ensure_ascii=False),
        "answer_index": correct_slot + 1,
        "explanation": explanation(answer),
        "image_url": "",
        "_kind": kind,
    })


def add_binary(kind: str, a, op: str, b) -> None:
    a = Fraction(a)
    b = Fraction(b)
    answer = a + b if op == "+" else a - b
    expr = f"{paren(a, True)} {op} {paren(b, True)}"
    add_row(kind, expr, answer, [a - b if op == "+" else a + b, -answer, answer + 10])


# 1. 整数の加減 18問
for item in [
    (11, "-", 7), (9, "-", 12), (0, "-", 23), (-13, "-", 25), (-9, "-", 78), (12, "-", -69),
    (-54, "-", -37), (-16, "-", -173), (327, "-", -48), (-8, "+", 15), (24, "+", -31),
    (-45, "+", 18), (36, "-", 52), (-72, "+", -19), (0, "-", -34), (58, "+", -75),
    (-120, "-", -45), (14, "-", -27),
]:
    add_binary("整数の加減", *item)

# 2. 小数の加減 12問
for item in [
    (Fraction(35, 10), "+", Fraction(52, 10)), (Fraction(-27, 10), "+", Fraction(-14, 10)),
    (Fraction(-132, 100), "+", Fraction(-415, 10)), (Fraction(-68, 10), "+", Fraction(85, 10)),
    (Fraction(-13, 10), "-", Fraction(25, 10)), (Fraction(-87, 10), "-", Fraction(-124, 10)),
    (Fraction(64, 10), "+", Fraction(-83, 10)), (Fraction(6, 10), "-", Fraction(-14, 10)),
    (Fraction(-132, 100), "+", Fraction(68, 100)), (Fraction(75, 10), "-", Fraction(92, 10)),
    (Fraction(-24, 10), "-", Fraction(-5, 10)), (Fraction(-32, 10), "+", Fraction(47, 10)),
]:
    add_binary("小数の加減", *item)

# 3. 分数の加減 14問
for item in [
    (Fraction(-1, 7), "+", Fraction(-2, 7)), (Fraction(-3, 4), "+", Fraction(-1, 6)),
    (Fraction(-7, 2), "+", Fraction(7, 3)), (Fraction(2, 7), "-", Fraction(1, 3)),
    (Fraction(-13, 4), "-", Fraction(-7, 18)), (Fraction(1, 12), "-", Fraction(7, 20)),
    (Fraction(2, 3), "-", Fraction(-1, 2)), (Fraction(5, 6), "+", Fraction(11, 12)),
    (Fraction(-3, 8), "+", Fraction(5, 6)), (Fraction(-4, 9), "-", Fraction(2, 3)),
    (Fraction(7, 10), "+", Fraction(-9, 20)), (Fraction(-5, 12), "-", Fraction(-1, 8)),
    (Fraction(3, 5), "-", Fraction(11, 15)), (Fraction(-7, 6), "+", Fraction(5, 9)),
]:
    add_binary("分数の加減", *item)

# 4. 連続加減 14問
for terms in [
    [7, -3, -2], [-27, -19, 1], [-3, 4, 6], [-3, 20, -8], [-16, 31, -37, 13],
    [26, 15, 19, -36], [6, -7, 13, -4, -9], [-5, -8, 12, -2, -10, 19],
    [14, -22, 9], [-18, 7, -11, 5], [32, -16, -9, 4], [-6, 13, -20, 8],
    [45, -28, -17, 6], [-12, -9, 30, -4],
]:
    answer = sum(Fraction(t) for t in terms)
    expr = " + ".join(str(terms[0]) if i == 0 else paren(Fraction(t), True) for i, t in enumerate(terms))
    add_row("整数の連続加減", expr, answer, [-answer, answer + 2, answer - terms[-1]])

# 5. 乗法 12問
for factors in [
    [-3, -4, -5], [4, -3, 5, -2], [-8, 5, Fraction(-1, 8), 3], [6, -5], [3, -15], [4, -7],
    [13, -9], [-3, 8], [-6, 7], [19, -1], [1, -22], [0, -6],
]:
    answer = Fraction(1)
    for factor in factors:
        answer *= Fraction(factor)
    expr = " \\times ".join(paren(Fraction(factor), True) for factor in factors)
    add_row("乗法", expr, answer, [-answer, abs(answer), answer + Fraction(factors[0])])

# 6. 除法 8問
for a, b in [
    (Fraction(-9), Fraction(3, 5)), (Fraction(-7, 8), Fraction(-14, 15)),
    (Fraction(6, 7), Fraction(-4, 5)), (Fraction(-3, 5), Fraction(-27, 25)),
    (Fraction(-18, 35), Fraction(9, 14)), (Fraction(-5, 3), Fraction(-10, 7)),
    (Fraction(12), Fraction(-3)), (Fraction(-21), Fraction(-7)),
]:
    answer = a / b
    expr = f"{paren(a, True)} \\div {paren(b, True)}"
    add_row("除法", expr, answer, [a * b, -answer, b / a])

# 7. 累乗 12問
for expr, answer, distractors in [
    ("8^2", 64, [16, -64, 256]), ("(-9)^2", 81, [-81, 18, 729]), ("5^3", 125, [15, -125, 25]),
    ("-(-7)^3", 343, [-343, 49, -49]), ("-3^4", -81, [81, -12, -64]),
    ("(-3)^2 \\times (-7)", -63, [63, -21, 126]), ("(-3)^3 \\times (-2)^2", -108, [108, -36, 54]),
    ("(-4)^3 \\div 2^2", -16, [16, -32, -8]), ("(-6^2) \\div (-3)^2", -4, [4, -12, 12]),
    ("(-10)^3 \\div (-5^2)", 40, [-40, 20, -20]),
    ("\\left(-\\frac{2}{3}\\right)^2", Fraction(4, 9), [Fraction(-4, 9), Fraction(2, 9), Fraction(4, 6)]),
    ("\\left(-\\frac{5}{4}\\right)^3", Fraction(-125, 64), [Fraction(125, 64), Fraction(-15, 12), Fraction(-25, 16)]),
]:
    add_row("累乗", expr, answer, distractors)

# 8. 四則混合 10問
for expr, answer, distractors in [
    ("-3^2 + 4 \\times (-2)", -17, [17, -2, -14]),
    ("12 - 6 \\div (-3)", 14, [10, -2, 6]),
    ("3^2 - (-2)^3 + 4 \\div (-2)", 15, [-1, 19, -15]),
    ("24 \\div (-6) + (-2)^2 \\times 3", 8, [-16, 16, -8]),
    ("-6 + 8 \\div (-4) - 3 \\times (-3)", 1, [-17, 5, -1]),
    ("(-3)^3 - 2^2 \\times 210 \\div (-35)", -3, [-51, 3, -15]),
    ("-\\frac{3}{10} + \\left(-\\frac{3}{2}\\right)^2 \\times \\frac{5}{4}", Fraction(201, 80), [Fraction(-201, 80), Fraction(99, 80), Fraction(39, 80)]),
    ("(-2)^3 + 3 \\times (-2) \\div \\frac{3}{4}", -16, [0, 16, -12]),
    ("\\frac{8}{5} \\times \\frac{3}{4} \\div \\left(-\\frac{2}{3}\\right)^2 - \\frac{7}{10}", 2, [-2, Fraction(1, 2), 4]),
    ("-2^2 \\div 3^3 \\times \\frac{1}{8} \\div \\frac{1}{9} + 1", Fraction(5, 6), [Fraction(-5, 6), Fraction(7, 6), Fraction(1, 6)]),
]:
    add_row("四則混合", expr, answer, distractors)

if len(rows) != 100:
    raise RuntimeError(f"Expected 100 rows, got {len(rows)}")

for index, row in enumerate(rows, 1):
    options = json.loads(row["options"])
    if len(options) != 4:
        raise RuntimeError(f"Row {index}: invalid option count")
    if len(set(options)) != 4:
        raise RuntimeError(f"Row {index}: duplicate option text")
    if not 1 <= row["answer_index"] <= 4:
        raise RuntimeError(f"Row {index}: invalid answer_index")

OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
with OUT_PATH.open("w", encoding="utf-8-sig", newline="") as file:
    writer = csv.DictWriter(file, fieldnames=[
        "unit_id", "category", "question_text", "options", "answer_index", "explanation", "image_url"
    ])
    writer.writeheader()
    for row in rows:
        writer.writerow({field: row[field] for field in writer.fieldnames})

counts = Counter(row["_kind"] for row in rows)
print(OUT_PATH)
print(f"rows={len(rows)}")
for key, value in counts.items():
    print(f"{key}={value}")
