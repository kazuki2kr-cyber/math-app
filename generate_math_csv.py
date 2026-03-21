import csv
import random
import json
import os

def generate_options(correct_answer, is_float=False, is_fraction=False):
    options = [correct_answer]
    while len(options) < 4:
        if is_float:
            # Generate plausible distractors for decimals
            wrong = round(correct_answer + random.choice([-10.0, -1.0, -0.1, 0.1, 1.0, 10.0]) * random.randint(1, 5), 1)
        elif is_fraction:
            # Simple distractors for fractions (just varying numerator)
            # correct_answer is passed as string, we'll just manipulate string or random numbers
            # This is simplified: we'll handle fraction distractors in the main loop
            pass
        else:
            wrong = correct_answer + random.choice([-1, 1]) * random.randint(1, 10)
            
        if is_fraction:
            continue # handled outside
            
        if wrong not in options:
            options.append(wrong)
            
    if not is_fraction:
        random.shuffle(options)
        answer_index = options.index(correct_answer) + 1
        return [str(opt) for opt in options], answer_index
    return [], 0

questions = []
unit_id = "1.正負の数の加減"

# 1. Integer Additions (10 questions)
for _ in range(10):
    a = random.randint(-20, 20)
    b = random.randint(-20, 20)
    ans = a + b
    opts, ans_idx = generate_options(ans)
    
    q_text = f"次の計算をしなさい。  \n\\( ({a}) + ({b}) \\)"
    expl = f"同符号・異符号の加法です。  \n\\( ({a}) + ({b}) = {ans} \\) となります。"
    questions.append([unit_id, q_text, json.dumps(opts, ensure_ascii=False), ans_idx, expl, ""])

# 2. Integer Subtractions (10 questions)
for _ in range(10):
    a = random.randint(-20, 20)
    b = random.randint(-20, 20)
    ans = a - b
    opts, ans_idx = generate_options(ans)
    
    q_text = f"次の計算をしなさい。  \n\\( ({a}) - ({b}) \\)"
    expl = f"減法は、引く数の符号を変えて加法に直して計算します。  \n\\( ({a}) - ({b}) = ({a}) + ({-b}) = {ans} \\) となります。"
    questions.append([unit_id, q_text, json.dumps(opts, ensure_ascii=False), ans_idx, expl, ""])

# 3. Three-term integer mixed (10 questions)
for _ in range(10):
    a = random.randint(-15, 15)
    b = random.randint(-15, 15)
    c = random.randint(-15, 15)
    ans = a - b + c
    opts, ans_idx = generate_options(ans)
    
    q_text = f"次の計算をしなさい。  \n\\( ({a}) - ({b}) + ({c}) \\)"
    expl = f"左から順に計算するか、加法だけの式に直して計算します。  \n\\( ({a}) - ({b}) + ({c}) = ({a}) + ({-b}) + ({c}) = {ans} \\) となります。"
    questions.append([unit_id, q_text, json.dumps(opts, ensure_ascii=False), ans_idx, expl, ""])

# 4. Decimal math (10 questions)
for _ in range(10):
    a = round(random.uniform(-10.0, 10.0), 1)
    b = round(random.uniform(-10.0, 10.0), 1)
    op = random.choice(["+", "-"])
    ans = round(a + b if op == "+" else a - b, 1)
    opts, ans_idx = generate_options(ans, is_float=True)
    
    q_text = f"次の計算をしなさい。  \n\\( ({a}) {op} ({b}) \\)"
    expl = f"小数の計算です。位をそろえて計算します。  \n\\( ({a}) {op} ({b}) = {ans} \\) となります。"
    questions.append([unit_id, q_text, json.dumps(opts, ensure_ascii=False), ans_idx, expl, ""])

# 5. Fraction math (10 questions)
import math
for _ in range(10):
    # a/c + b/c
    c = random.choice([2, 3, 4, 5, 6, 7, 8, 9])
    a = random.randint(-10, 10)
    b = random.randint(-10, 10)
    op = random.choice(["+", "-"])
    ans_num = a + b if op == "+" else a - b
    
    def simplify(num, den):
        g = math.gcd(abs(num), den)
        return num // g, den // g
        
    s_ans_num, s_ans_den = simplify(ans_num, c)
    s_a_num, s_a_den = simplify(a, c)
    s_b_num, s_b_den = simplify(b, c)
    
    def format_frac(num, den):
        if num == 0: return "0"
        if den == 1: return str(num)
        sign = "-" if num < 0 else ""
        return f"{sign}\\frac{{{abs(num)}}}{{{den}}}"

    ans_str = format_frac(s_ans_num, s_ans_den)
    opts = [ans_str]
    while len(opts) < 4:
        wrong_num = s_ans_num + random.choice([-2, -1, 1, 2, 3])
        wrong_str = format_frac(wrong_num, s_ans_den)
        if wrong_str not in opts:
            opts.append(wrong_str)
            
    random.shuffle(opts)
    ans_idx = opts.index(ans_str) + 1
    
    a_str = format_frac(s_a_num, s_a_den)
    b_str = format_frac(s_b_num, s_b_den)
    
    q_text = f"次の計算をしなさい。  \n\\( ({a_str}) {op} ({b_str}) \\)"
    expl = f"分数の計算です。分母をそろえて（通分して）分子どうしを計算します。最後は約分できる場合は約分します。  \n結果は \\( {ans_str} \\) となります。"
    questions.append([unit_id, q_text, json.dumps(opts, ensure_ascii=False), ans_idx, expl, ""])


output_path = r"C:\Users\ichikawa\Desktop\math.app\1.正負の数の加減.csv"
with open(output_path, "w", encoding="utf-8-sig", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(["unit_id", "question_text", "options", "answer_index", "explanation", "image_url"])
    writer.writerows(questions)

print(f"Successfully generated {len(questions)} questions to {output_path}")
