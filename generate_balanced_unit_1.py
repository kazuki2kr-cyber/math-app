import csv
import json
import random
import math
import re

def fmt(x):
    return f"({x})" if float(x) < 0 else str(x)

def fmt_str(s):
    return f"({s})" if s.startswith("-") else s

def create_options_auto(correct_val, is_fraction=False, correct_idx=None, manual_dummies=None):
    if correct_idx is None:
        correct_idx = random.randint(0, 3)
    
    options = [""] * 4
    options[correct_idx] = correct_val
    
    dummies = set()
    if manual_dummies:
        for d in manual_dummies:
            dummies.add(d)
            if len(dummies) == 3: break
            
    # Try dynamic numerical dummy generation if manual ones not sufficient
    if len(dummies) < 3 and is_fraction and "\\frac" in correct_val:
        is_neg = correct_val.startswith("-")
        clean_val = correct_val.replace("-\\frac{", "").replace("\\frac{", "").replace("}", "")
        parts = clean_val.split("{")
        if len(parts) == 2:
            try:
                n, d = int(parts[0]), int(parts[1])
                for dn_offset in [-1, 1, 2, 3]:
                    dn = max(1, n + dn_offset)
                    val = f"\\frac{{{dn}}}{{{d}}}"
                    if is_neg:
                        val = "-" + val if random.random() > 0.3 else val
                    else:
                        val = "-" + val if random.random() > 0.7 else val
                    if val != correct_val:
                        dummies.add(val)
            except:
                pass

    if len(dummies) < 3 and not is_fraction:
        try:
            val = float(correct_val)
            if val.is_integer():
                val = int(val)
                dummies.add(str(-val) if val != 0 else "1")
                for dn in [-10, -1, 1, 10]:
                    if str(val + dn) != correct_val:
                        dummies.add(str(val + dn))
            else:
                dummies.add(str(round(-val, 1)) if val != 0 else "1.0")
                for dn in [-1.5, -0.5, 0.5, 1.5]:
                    if str(round(val + dn, 1)) != correct_val:
                        dummies.add(str(round(val + dn, 1)))
        except:
            # Match number and unit
            m = re.match(r"([+-]?\d+)\s*(.*)", correct_val)
            if m:
                num_str, unit = m.group(1), m.group(2)
                num = int(num_str)
                dummies.add(f"{str(-num)} {unit}".strip())
                dummies.add(f"{str(num + random.choice([1, 2, 5, 10]))} {unit}".strip())
                dummies.add(f"{str(num + random.choice([-1, -2, -5, -10]))} {unit}".strip())
            
    attempt = 1
    while len(dummies) < 3:
        if "\\frac" in correct_val:
            cand = correct_val.replace("1", str(attempt + 1)).replace("2", str(attempt + 2))
            if cand == correct_val or cand in dummies: cand += str(attempt)
            dummies.add(cand)
        else:
            cand = correct_val + str(attempt)
            dummies.add(cand)
        attempt += 1

    dummy_list = list(dummies)[:3]
    idx = 0
    for i in range(4):
        if i != correct_idx:
            options[i] = dummy_list[idx]
            idx += 1
            
    return json.dumps(options, ensure_ascii=False), correct_idx + 1

questions = []
unit_id = "1.正負の数の加減"

# 1. Conceptual Word Problems (10 problems)
cp1 = [
    {
        "q": "次の数量を、正の数または負の数を用いて表しなさい。\n北へ 5 km 移動することを +5 km と表すとき、南へ 7 km 移動すること",
        "ans": "-7 km", "exp": "方向が逆になるため、負の符号（マイナス）を用いて表します。", "dm": ["+7 km", "-2 km", "+2 km"]
    },
    {
        "q": "次の数量を、正の数または負の数を用いて表しなさい。\n250 円の支出を -250 円と表すとき、750 円の収入",
        "ans": "+750 円", "exp": "支出が負の数であるため、逆の意味になる収入は正の符号（プラス）を用いて表します。", "dm": ["-750 円", "+500 円", "-500 円"]
    },
    {
        "q": "次の数量を、正の数または負の数を用いて表しなさい。\n2時間後を +2時間 と表すとき、6時間前",
        "ans": "-6 時間", "exp": "「後」がプラスであるため、逆の「前」は負の符号（マイナス）を用いて表します。", "dm": ["+6 時間", "-4 時間", "+8 時間"]
    },
    {
        "q": "現在の気温を基準の 0℃ とします。3℃ 高いことを +3℃ と表すとき、4℃ 低いことはどう表しますか。",
        "ans": "-4℃", "exp": "「高い」がプラスなので、逆の「低い」はマイナスを用いて表します。", "dm": ["+4℃", "-1℃", "-7℃"]
    },
    {
        "q": "海面を 0 m としたとき、海抜 3000 m の山の頂上の高さを +3000 m とします。では、海面下 200 m の潜水艦の深さはどのように表しますか。",
        "ans": "-200 m", "exp": "海面より高い場所を正、低い場所を負で表します。", "dm": ["+200 m", "-2800 m", "+3200 m"]
    },
    {
        "q": "目標体重から 1 kg 減ったことを -1 kg と表すとき、目標から 2 kg 増えたことはどう表しますか。",
        "ans": "+2 kg", "exp": "減少がマイナスなので、増加はプラス符号を用います。", "dm": ["-2 kg", "+3 kg", "-1 kg"]
    },
    {
        "q": "次の数量を正の数・負の数を用いて表しなさい。\n東西に伸びる道路で、東へ 10 m 進むことを +10 m と表すとき、西へ 8 m 進むこと",
        "ans": "-8 m", "exp": "東が正の方向なので、逆の西は負の方向となります。", "dm": ["+8 m", "-2 m", "+18 m"]
    },
    {
        "q": "テストの平均点が 60 点でした。Aさんの点数が 65 点のとき、平均点との違いを +5 点と表します。Bさんの点数が 52 点のとき、平均点との違いはどう表しますか。",
        "ans": "-8 点", "exp": "平均点より低い場合はマイナスを用いて表します。60 - 52 = 8 点低いので -8点です。", "dm": ["+8 点", "-2 点", "+12 点"]
    },
    {
        "q": "今から 3 年後を +3 年と表すとき、10 年前はどう表しますか。",
        "ans": "-10 年", "exp": "未来をプラスで表すとき、過去はマイナスで表します。", "dm": ["+10 年", "-7 年", "+13 年"]
    },
    {
        "q": "基準の長さより 5 cm 長いことを +5 cm と表します。基準より 12 cm 短いことはどう表しますか。",
        "ans": "-12 cm", "exp": "長いことをプラスとする場合、短いことはマイナスで表します。", "dm": ["+12 cm", "-7 cm", "+17 cm"]
    }
]
for p in cp1:
    opts, a_idx = create_options_auto(p["ans"], manual_dummies=p.get("dm"))
    questions.append([unit_id, p["q"], opts, a_idx, p["exp"], ""])

# 2. Vocabulary & Properties (10 problems)
vp1 = [
    {
        "q": "次の数の絶対値を答えなさい。\n-15",
        "ans": "15", "exp": "絶対値とは数直線上で0からの距離のことです。符号を外した値になります。", "dm": ["-15", "0", "-5"]
    },
    {
        "q": "数直線上で、原点（0）からある数までの距離のことを何といいますか。",
        "ans": "絶対値", "exp": "0からの距離を絶対値と呼びます。", "dm": ["相対値", "反対数", "逆数"]
    },
    {
        "q": "次の2つの数の大小を、不等号を使って表しなさい。\n-4 と -7",
        "ans": "-4 > -7", "exp": "負の数では、絶対値が大きいほど小さくなります。", "dm": ["-4 < -7", "-4 = -7", "4 > 7"]
    },
    {
        "q": "絶対値が 3 になる数をすべて答えなさい。",
        "ans": "3, -3", "exp": "0から距離が3の点は、正の方向と負の方向に1つずつあります。", "dm": ["3のみ", "-3のみ", "0, 3"]
    },
    {
        "q": "絶対値が 4 より小さい整数はいくつありますか。",
        "ans": "7個", "exp": "該当するのは -3, -2, -1, 0, 1, 2, 3 の7個です。", "dm": ["6個", "8個", "9個"]
    },
    {
        "q": "次のうち、絶対値が最も大きい数はどれですか。\n-12, 5, 0, -8, 10",
        "ans": "-12", "exp": "符号を外した数（距離）が最も大きいのは 12（元の数は-12）です。", "dm": ["10", "0", "-8"]
    },
    {
        "q": "次の数を小さい順に並べたとき、一番小さくなる数はどれですか。\n-0.5, -2, 0, -1.5",
        "ans": "-2", "exp": "負の数は、絶対値が大きいほど小さくなります。", "dm": ["-0.5", "0", "-1.5"]
    },
    {
        "q": "0 より -5 大きい数（0から負の方向に5進んだ数）は何ですか。",
        "ans": "-5", "exp": "0より5小さい数なので-5となります。", "dm": ["5", "0", "-10"]
    },
    {
        "q": "正の数について、正しい性質はどれですか。",
        "ans": "0より大きい数", "exp": "正の数は0より大きい数です。", "dm": ["0より小さい数", "0から遠い数", "マイナスがつく数"]
    },
    {
        "q": "負の符号「-」をつけて表される数を何といいますか。",
        "ans": "負の数", "exp": "0より小さい数を負の数といいます。", "dm": ["正の数", "自然数", "小数"]
    }
]
for p in vp1:
    opts, a_idx = create_options_auto(p["ans"], manual_dummies=p.get("dm"))
    questions.append([unit_id, p["q"], opts, a_idx, p["exp"], ""])

# 3. Calculation Problems (30 problems)
for _ in range(10):
    a = random.randint(-20, 20)
    b = random.randint(-20, 20)
    op = random.choice(["+", "-"])
    ans = a + b if op == "+" else a - b
    q = f"次の計算をしなさい。\n\\( {fmt(a)} {op} {fmt(b)} \\)"
    opts, a_idx = create_options_auto(str(ans))
    exp = f"同符号・異符号の計算です。\\( {fmt(a)} {op} {fmt(b)} = {ans} \\) となります。"
    questions.append([unit_id, q, opts, a_idx, exp, ""])

for _ in range(10):
    a = round(random.uniform(-10.0, 10.0), 1)
    b = round(random.uniform(-10.0, 10.0), 1)
    op = random.choice(["+", "-"])
    ans = round(a + b if op == "+" else a - b, 1)
    q = f"次の計算をしなさい。\n\\( {fmt(a)} {op} {fmt(b)} \\)"
    opts, a_idx = create_options_auto(str(ans))
    exp = f"小数の正負の計算です。位をそろえて計算します。\\( {fmt(a)} {op} {fmt(b)} = {ans} \\) となります。"
    questions.append([unit_id, q, opts, a_idx, exp, ""])

for _ in range(10):
    d = random.choice([2, 3, 4, 5, 6, 7, 8, 9])
    n1 = random.randint(1, 15) * random.choice([-1, 1])
    n2 = random.randint(1, 15) * random.choice([-1, 1])
    op = random.choice(["+", "-"])
    ans_n = n1 + n2 if op == "+" else n1 - n2
    
    gcd = math.gcd(abs(ans_n), d)
    sn, sd = 0, 1
    if gcd != 0:
        sn, sd = ans_n // gcd, d // gcd
    
    if sd == 1:
        ans_str = str(sn)
    elif sn == 0:
        ans_str = "0"
    else:
        ans_str = f"\\frac{{{abs(sn)}}}{{{sd}}}"
        if sn < 0: ans_str = "-" + ans_str
        
    s1 = f"\\frac{{{abs(n1)}}}{{{d}}}"
    if n1 < 0: s1 = "-" + s1
    s2 = f"\\frac{{{abs(n2)}}}{{{d}}}"
    if n2 < 0: s2 = "-" + s2
    
    q = f"次の計算をしなさい。\n\\( {fmt_str(s1)} {op} {fmt_str(s2)} \\)"
    opts, a_idx = create_options_auto(ans_str, is_fraction=True)
    exp = f"分母が同じなので分子同士を計算します。最後は約分できる場合は約分します。正解は \\( {ans_str} \\) です。"
    questions.append([unit_id, q, opts, a_idx, exp, ""])

random.shuffle(questions)

with open('C:/Users/ichikawa/Desktop/math.app/1.正負の数の加減.csv', 'w', newline='', encoding='utf-8') as f:
    writer = csv.writer(f)
    writer.writerow(["unit_id", "question_text", "options", "answer_index", "explanation", "image_url"])
    for row in questions:
        writer.writerow(row)

print("Balanced CSV generation complete: 50 questions.")
