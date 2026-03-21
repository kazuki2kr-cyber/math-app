import csv
import json
import random
import math

unit_id = "3.正負の数の四則"
questions = []

def create_options_auto(correct_val, is_fraction=False, manual_dummies=None):
    dummies = set()
    if manual_dummies:
        for d in manual_dummies:
            if str(d) != str(correct_val):
                dummies.add(str(d))
    
    attempt = 1
    while len(dummies) < 3:
        try:
            if is_fraction:
                if "\\frac" in str(correct_val):
                    import re
                    match = re.search(r"\\frac\{(-?\d+)\}\{(-?\d+)\}", str(correct_val))
                    if match:
                        n = int(match.group(1))
                        d = int(match.group(2))
                        candidates = [
                            f"\\frac{{{-n}}}{{{d}}}",
                            f"\\frac{{{n}}}{{{-d}}}",
                            f"\\frac{{{d}}}{{{n}}}" if n != 0 else None,
                            f"\\frac{{{n + random.randint(-4, 4)}}}{{{d}}}",
                            f"\\frac{{{n}}}{{{d + random.randint(1, 4)}}}"
                        ]
                        cand = random.choice([c for c in candidates if c])
                    else:
                        cand = str(correct_val) + str(attempt)
                else:
                    cand = str(correct_val) + str(attempt)
            else:
                num_str = str(correct_val).replace("(", "").replace(")", "").replace("\\times", "").replace("^", "")
                try:
                    num = float(num_str)
                    if num == int(num):
                        cand = str(int(num) + random.choice([-2, -1, 1, 2, 5, -5, 10, -10]))
                    else:
                        cand = str(round(num + random.choice([-1.0, 1.0, 0.1, -0.1, 0.5, -0.5]), 2))
                except:
                    # For non-numeric strings (like prime factorization), generate semantically similar dummies
                    if "^" in str(correct_val):
                        cand = str(correct_val).replace("^2", "^3").replace("^3", "^2")
                        if cand == correct_val: cand = str(correct_val) + "'"
                    else:
                        cand = str(correct_val) + str(attempt)
            
            if str(cand) != str(correct_val) and cand not in dummies:
                dummies.add(str(cand))
        except:
            dummies.add(str(correct_val) + "_" + str(attempt))
        attempt += 1
        if attempt > 200: break

    dummy_list = list(dummies)[:3]
    opts = dummy_list + [str(correct_val)]
    random.shuffle(opts)
    # Wrap in delimiters if looks like math and not wrapped
    final_opts = []
    for o in opts:
        if ("\\" in o or "^" in o or "/" in o) and not o.startswith("\\("):
            final_opts.append(f"\\( {o} \\)")
        else:
            final_opts.append(o)
            
    # Escape single backslash to double for JSON
    opts_json = json.dumps(final_opts, ensure_ascii=False)
    return opts_json, opts.index(str(correct_val)) + 1

# 1. 文章題・概念 (5問)
concepts = [
    ("累乗について、\\( (-2)^2 \\) の計算結果はいくらですか。", "4", ["-4", "2", "-2"]),
    ("累乗について、\\( -2^2 \\) の計算結果はいくらですか。", "-4", ["4", "2", "-2"]),
    ("1以外で、1とその数自身以外に約数をもたない自然数を何といいますか。", "素数", ["合成数", "因数", "倍数"]),
    ("ある自然数を素数だけの積の形で表すことを何といいますか。", "素因数分解", ["因数分解", "等式変形", "比例"]),
    ("計算の順序について、四則が混じった計算ではどこを最優先しますか。", "括弧( )の中", ["かけ算・わり算", "たし算・ひき算", "左から順に"])
]
for q, ans, ds in concepts:
    opts, a_idx = create_options_auto(ans, manual_dummies=ds)
    questions.append([unit_id, q, opts, a_idx, f"正解は {ans} です。", ""])

# 2. 整数四則混合 (15問)
for _ in range(15):
    a = random.randint(-15, 15)
    b = random.randint(-8, 8)
    c = random.randint(-8, 8)
    if random.choice([True, False]): # a + b * c
        ans = a + (b * c)
        q = f"次の計算をしなさい。\\( {a} + ({b}) \\times ({c}) \\)"
        exp = f"先にかけ算を計算します。\\( ({b}) \\times ({c}) = {b*c} \\) なので、\\( {a} + ({b*c}) = {ans} \\) です。"
    else: # (a + b) * c
        ans = (a + b) * c
        q = f"次の計算をしなさい。\\( ({a} + ({b})) \\times ({c}) \\)"
        exp = f"先に括弧の中を計算します。\\( {a} + ({b}) = {a+b} \\) なので、\\( {a+b} \\times ({c}) = {ans} \\) です。"
    opts, a_idx = create_options_auto(str(ans))
    questions.append([unit_id, q, opts, a_idx, exp, ""])

# 3. 分数・小数四則 (15問)
for _ in range(15):
    if random.choice([True, False]): # Decimal
        a = round(random.uniform(-5, 5), 1)
        b = round(random.uniform(-2, 2), 1)
        ans = round(a * 2 + b, 1) # simple chain
        q = f"次の計算をしなさい。\\( {a} \\times 2 + ({b}) \\)"
        exp = f"計算結果は {ans} です。"
        opts, a_idx = create_options_auto(str(ans))
    else: # Fraction
        n, d = random.randint(1, 4), random.randint(2, 6)
        ans_str = f"\\frac{{{n}}}{{{d}}}"
        q = f"次の計算をしなさい。\\( \\frac{{{n*2}}}{{{d}}} \\times \\frac{{1}}{{2}} \\)"
        exp = f"分数の計算です。正解は {ans_str} です。"
        opts, a_idx = create_options_auto(ans_str, is_fraction=True)
    questions.append([unit_id, q, opts, a_idx, exp, ""])

# 4. 素因数分解・平方・最大公約数 (15問)
primes_data = [
    (12, "2^2 \\times 3"), (18, "2 \\times 3^2"), (20, "2^2 \\times 5"), 
    (36, "2^2 \\times 3^2"), (48, "2^4 \\times 3"), (72, "2^3 \\times 3^2"),
    (90, "2 \\times 3^2 \\times 5"), (105, "3 \\times 5 \\times 7"),
    (540, "2^2 \\times 3^3 \\times 5"), (588, "2^2 \\times 3 \\times 7^2")
]
for _ in range(15):
    item = random.choice(primes_data)
    v, ans = item
    q = f"\\( {v} \\) を素因数分解しなさい。"
    exp = f"{v} を素数でわっていくと {ans} になります。"
    # Manual dummies for prime factorization to be realistic
    ds = [ans.replace("2", "3"), ans.replace("^2", "^3"), ans.replace("\\times", "+")]
    opts, a_idx = create_options_auto(ans, manual_dummies=ds)
    questions.append([unit_id, q, opts, a_idx, exp, ""])

# Output to CSV
output_file = "3.正負の数の四則.csv"
with open(output_file, 'w', encoding='utf-8', newline='') as f:
    writer = csv.writer(f, quoting=csv.QUOTE_ALL)
    writer.writerow(["unit_id", "question_text", "options", "answer_index", "explanation", "image_url"])
    for row in questions:
        writer.writerow(row)
print(f"Generated {len(questions)} questions")
