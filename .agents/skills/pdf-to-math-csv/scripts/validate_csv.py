import csv
import json
import re
import sys
import os

def validate_and_fix(csv_path):
    if not os.path.exists(csv_path):
        print(f"Error: File {csv_path} not found.")
        return

    changes = []
    rows = []
    
    # regex for leading zeros: matches 01, 007, but not 0.5 or 0
    # Uses negative lookbehind to avoid decimals or digits before the zero
    leading_zero_re = re.compile(r'(?<![\d.])0+([1-9]\d*)')

    with open(csv_path, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        for i, row in enumerate(reader, start=2): # 1-indexed, +1 for header
            row_changed = False
            
            question_type = (row.get('question_type') or row.get('questionType') or 'multiple_choice').strip()
            is_written = question_type == 'written'

            for field in ['question_text', 'options', 'explanation', 'model_answer', 'grading_rubric']:
                if field not in row:
                    continue
                original_val = row.get(field) or ''
                
                # 1. Fix leading zeros
                new_val = leading_zero_re.sub(r'\1', original_val)
                
                # 2. Basic LaTeX delimiter check (optional reporting)
                open_count = new_val.count('\\\\(') or new_val.count('\\(')
                close_count = new_val.count('\\\\)') or new_val.count('\\)')
                if open_count != close_count:
                    print(f"[Warning] Line {i}: LaTeX delimiter mismatch in {field} ({open_count} opening vs {close_count} closing)")

                if new_val != original_val:
                    row[field] = new_val
                    changes.append({
                        'line': i,
                        'field': field,
                        'from': original_val,
                        'to': new_val
                    })
                    row_changed = True

            # 3. Check JSON options
            try:
                opts = json.loads(row.get('options') or '[]')
                if is_written:
                    if not isinstance(opts, list):
                        print(f"[Error] Line {i}: written 'options' must be a JSON array, usually []. Found: {row.get('options')}")
                elif not isinstance(opts, list) or len(opts) != 4:
                    print(f"[Error] Line {i}: 'options' must be a JSON array of 4 items. Found: {row.get('options')}")
                else:
                    # Check for leading zeros in options list specifically if not already caught
                    new_opts = []
                    opts_changed = False
                    for opt in opts:
                        if isinstance(opt, str):
                            fixed_opt = leading_zero_re.sub(r'\1', opt)
                            if fixed_opt != opt:
                                opts_changed = True
                            new_opts.append(fixed_opt)
                        else:
                            new_opts.append(opt)
                    
                    if opts_changed:
                        new_json = json.dumps(new_opts, ensure_ascii=False)
                        changes.append({
                            'line': i,
                            'field': 'options (JSON content)',
                            'from': row['options'],
                            'to': new_json
                        })
                        row['options'] = new_json
                        row_changed = True
            except json.JSONDecodeError:
                print(f"[Error] Line {i}: 'options' is not a valid JSON string. Found: {row.get('options')}")

            # 4. Check answer_index
            try:
                ans_idx = int(row.get('answer_index') or 1)
                if is_written:
                    if ans_idx != 1:
                        print(f"[Warning] Line {i}: written 'answer_index' should be 1. Found: {ans_idx}")
                elif not (1 <= ans_idx <= 4):
                    print(f"[Error] Line {i}: 'answer_index' must be between 1 and 4. Found: {ans_idx}")
            except ValueError:
                print(f"[Error] Line {i}: 'answer_index' is not an integer. Found: {row.get('answer_index')}")

            # 5. Written-event specific checks
            if is_written:
                model_answer = (row.get('model_answer') or row.get('modelAnswer') or '').strip()
                rubric = (row.get('grading_rubric') or row.get('gradingRubric') or '').strip()
                if not model_answer:
                    print(f"[Error] Line {i}: written question requires model_answer.")
                if not rubric:
                    print(f"[Warning] Line {i}: written question should include grading_rubric for stable Gemini grading.")
                else:
                    try:
                        parsed_rubric = json.loads(rubric)
                        if not isinstance(parsed_rubric, list) or len(parsed_rubric) == 0:
                            print(f"[Warning] Line {i}: grading_rubric should be a non-empty JSON array.")
                        else:
                            rubric_text = ' '.join(str(item) for item in parsed_rubric)
                            strict_keywords = [
                                ('variable definition', ['文字', '変数', '設定', '定義', '置く', 'おく']),
                                ('conclusion', ['結論', '最終答', '答え']),
                                ('reasoning steps', ['途中', '計算', '立式', '式']),
                            ]
                            for label, keywords in strict_keywords:
                                if not any(keyword in rubric_text for keyword in keywords):
                                    print(f"[Warning] Line {i}: grading_rubric should include a strict {label} criterion.")
                            if not any(keyword in rubric_text for keyword in ['60点', '60']):
                                print(f"[Warning] Line {i}: grading_rubric should clearly allocate about 60 points to process/reasoning.")
                            if not any(keyword in rubric_text for keyword in ['40点', '40']):
                                print(f"[Warning] Line {i}: grading_rubric should clearly allocate about 40 points to final answer/conclusion.")
                    except json.JSONDecodeError:
                        print(f"[Error] Line {i}: grading_rubric is not valid JSON. Found: {rubric}")

                limit_value = row.get('written_attempt_limit')
                if limit_value:
                    try:
                        attempt_limit = int(limit_value)
                        if attempt_limit != 1:
                            print(f"[Warning] Line {i}: written_attempt_limit should normally be 1. Found: {attempt_limit}")
                    except ValueError:
                        print(f"[Error] Line {i}: written_attempt_limit is not an integer. Found: {limit_value}")

            rows.append(row)

    if changes:
        # Write back to file
        with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
        
        print(f"\nCorrection Report for {csv_path}:")
        print("-" * 40)
        for c in changes:
            print(f"Line {c['line']} [{c['field']}]:")
            print(f"  From: {c['from']}")
            print(f"  To:   {c['to']}")
        print("-" * 40)
        print(f"Total changes: {len(changes)}")
    else:
        print(f"No corrections needed for {csv_path}.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python validate_csv.py <path_to_csv>")
    else:
        validate_and_fix(sys.argv[1])
