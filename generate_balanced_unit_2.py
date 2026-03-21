import csv
import json
import random

unit_id = "2.正負の数の乗除"
questions = []

def create_options_auto(correct_val, is_fraction=False, manual_dummies=None):
    dummies = set()
    if manual_dummies:
        for d in manual_dummies:
            if str(d) != str(correct_val):
                dummies.add(str(d))
    
    # Simple numeric logic for more dummies if needed
    attempt = 1
    while len(dummies) < 3:
        try:
            if is_fraction:
                if "/" in correct_val:
                    # Very simple fraction logic: flip sign or change numerator/denominator slightly
                    if attempt == 1:
                        cand = "-" + correct_val if not correct_val.startswith("-") else correct_val[1:]
                    else:
                        cand = f"{random.randint(1,15)}/{random.randint(2,15)}"
                else:
                    cand = str(int(correct_val) + random.choice([-1, 1, 2]))
            else:
                num = float(correct_val)
                if num == int(num):
                    cand = str(int(num) + random.choice([-1, 1, 2, -2, 5, -5]))
                else:
                    cand = str(round(num + random.choice([-0.1, 0.1, 0.2, -0.2]), 2))
            
            if str(cand) != str(correct_val):
                dummies.add(str(cand))
        except:
            dummies.add(str(correct_val) + str(attempt))
        attempt += 1
        if attempt > 100: break # Safety

    dummy_list = list(dummies)[:3]
    opts = dummy_list + [str(correct_val)]
    random.shuffle(opts)
    return json.dumps(opts, ensure_ascii=False), opts.index(str(correct_val)) + 1

# 1. 文章題 / 概念 (10問)
concepts = [
    ("正の数に負の数をかけると、積の符号はどうなりますか。", "負", ["正", "0", "変化しない"]),
    ("負の数に負の数をかけると、積の符号はどうなりますか。", "正", ["負", "0", "変化しない"]),
    ("ある数を 0 でわるとどうなりますか。", "計算できない", ["0になる", "1になる", "元の数と同じ"]),
    ("逆数とは、その数とかけたときに何になる数ですか。", "1", ["0", "-1", "元の数"]),
    ("-3/4 の逆数は何ですか。", "-4/3", ["3/4", "4/3", "-3/4"]),
    ("積の符号を決めるとき、負の数が奇数個あると符号はどうなりますか。", "負 (-)", ["正 (+)", "0", "決まらない"]),
    ("積の符号を決めるとき、負の数が偶数個あると符号はどうなりますか。", "正 (+)", ["負 (-)", "0", "決まらない"]),
    ("0 にどんな数をかけても、積はいくらになりますか。", "0", ["1", "その数自体", "計算できない"]),
    ("2の3乗 (\\( 2^3 \\)) の値はいくらですか。", "8", ["6", "9", "16"]),
    ("(-3)の2乗 (\\( (-3)^2 \\)) の値はいくらですか。", "9", ["-9", "6", "-6"])
]

for q_text, ans, ds in concepts:
    opts, a_idx = create_options_auto(ans, manual_dummies=ds)
    exp = f"正解は {ans} です。"
    questions.append([unit_id, q_text, opts, a_idx, exp, ""])

# 2. 整数乗除 (15問)
for _ in range(15):
    a = random.randint(-15, 15)
    b = random.choice([x for x in range(-12, 13) if x != 0])
    if random.choice([True, False]): # 乗法
        ans = a * b
        q = f"次の計算をしなさい。\n\\( ({a}) \\times ({b}) \\)"
        exp = f"計算結果は {ans} です。"
    else: # 除法
        ans = a
        multi = a * b
        q = f"次の計算をしなさい。\n\\( ({multi}) \\div ({b}) \\)"
        exp = f"計算結果は {ans} です。"
    opts, a_idx = create_options_auto(str(ans))
    questions.append([unit_id, q, opts, a_idx, exp, ""])

# 3. 小数乗除 (10問)
for _ in range(10):
    a = round(random.uniform(-5, 5), 1)
    b = random.choice([0.2, 0.5, -0.2, -0.5, 2, -2])
    if random.choice([True, False]):
        ans = round(a * b, 2)
        q = f"次の計算をしなさい。\n\\( ({a}) \\times ({b}) \\)"
    else:
        ans = round(a / b, 2)
        q = f"次の計算をしなさい。\n\\( ({a}) \\div ({b}) \\)"
    opts, a_idx = create_options_auto(str(ans))
    exp = f"小数の計算です。符号に注意して計算すると {ans} になります。"
    questions.append([unit_id, q, opts, a_idx, exp, ""])

# 4. 分数乗除 (15問)
for _ in range(15):
    n1, d1 = random.randint(-9, 9), random.randint(2, 9)
    if n1 == 0: n1 = 1
    n2, d2 = random.randint(-9, 9), random.randint(2, 9)
    if n2 == 0: n2 = 1
    
    if random.choice([True, False]): # multiplication
        # simple display
        q = f"次の計算をしなさい。\n\\( (\\frac{{{n1}}}{{{d1}}}) \\times (\\frac{{{n2}}}{{{d2}}}) \\)"
        # result logic (simplified for CSV generation)
        res_n = n1 * n2
        res_d = d1 * d2
        ans_str = f"\\frac{{{res_n}}}{{{res_d}}}"
    else: # division
        q = f"次の計算をしなさい。\n\\( (\\frac{{{n1}}}{{{d1}}}) \\div (\\frac{{{n2}}}{{{d2}}}) \\)"
        res_n = n1 * d2
        res_d = d1 * n2
        ans_str = f"\\frac{{{res_n}}}{{{res_d}}}"

    opts, a_idx = create_options_auto(ans_str, is_fraction=True)
    exp = f"分数の計算です。除法の場合は逆数をかけます。正解は \\( {ans_str} \\) です。"
    questions.append([unit_id, q, opts, a_idx, exp, ""])

# Output to CSV
output_file = "2.正負の数の乗除.csv"
with open(output_file, 'w', encoding='utf-8', newline='') as f:
    writer = csv.writer(f, quoting=csv.QUOTE_ALL)
    writer.writerow(["unit_id", "question_text", "options", "answer_index", "explanation", "image_url"])
    for row in questions:
        writer.writerow(row)

print(f"Generated {len(questions)} questions in {output_file}")
