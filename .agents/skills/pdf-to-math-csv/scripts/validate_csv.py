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
            
            for field in ['question_text', 'options', 'explanation']:
                original_val = row[field]
                
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
                opts = json.loads(row['options'])
                if not isinstance(opts, list) or len(opts) != 4:
                    print(f"[Error] Line {i}: 'options' must be a JSON array of 4 items. Found: {row['options']}")
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
                print(f"[Error] Line {i}: 'options' is not a valid JSON string. Found: {row['options']}")

            # 4. Check answer_index
            try:
                ans_idx = int(row['answer_index'])
                if not (1 <= ans_idx <= 4):
                    print(f"[Error] Line {i}: 'answer_index' must be between 1 and 4. Found: {ans_idx}")
            except ValueError:
                print(f"[Error] Line {i}: 'answer_index' is not an integer. Found: {row['answer_index']}")

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
