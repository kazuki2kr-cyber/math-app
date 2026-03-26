import csv
import glob
import os

files = glob.glob('c:/Users/ichikawa/Desktop/math.app/*.csv')
for f in files:
    temp_f = f + '.tmp'
    try:
        with open(f, 'r', encoding='utf-8') as infile:
            reader = csv.DictReader(infile)
            fieldnames = reader.fieldnames
            if 'category' not in fieldnames:
                fieldnames.append('category')
            
            rows = []
            for row in reader:
                row['category'] = '1.正の数と負の数'
                rows.append(row)
                
        with open(temp_f, 'w', encoding='utf-8', newline='') as outfile:
            writer = csv.DictWriter(outfile, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
            
        os.replace(temp_f, f)
        print(f"Updated {f}")
    except Exception as e:
        print(f"Error processing {f}: {e}")
