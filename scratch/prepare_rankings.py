import json

# パスは適宜書き換えてください（直前の出力ファイル）
input_file = r'c:\Users\ichikawa\.gemini\antigravity\brain\cf33d03e-a527-4db6-906d-ee4f4e07bd14\.system_generated\steps\1132\output.txt'
output_file = r'c:\Users\ichikawa\Desktop\math.app\scratch\leaderboard_fixed.json'

with open(input_file, 'r', encoding='utf-8') as f:
    data = json.load(f)

players = []
for doc in data.get('documents', []):
    fields = doc.get('fields', {})
    
    uid = fields.get('uid', {}).get('stringValue')
    name = fields.get('displayName', {}).get('stringValue', '不明')
    # integerValue は文字列として格納されている場合があるため int() 変換
    totalScore = int(fields.get('totalScore', {}).get('integerValue', 0))
    xp = int(fields.get('xp', {}).get('integerValue', 0))
    icon = fields.get('icon', {}).get('stringValue', '📐')
    level = int(fields.get('level', {}).get('integerValue', 1))

    if totalScore > 0 or xp > 0:
        players.append({
            'uid': uid,
            'name': name,
            'totalScore': totalScore,
            'xp': xp,
            'icon': icon,
            'level': level
        })

# ソート: totalScore (降順) -> xp (降順)
players.sort(key=lambda x: (-x['totalScore'], -x['xp']))

# 上位40名
rankings = players[:40]

result = {
    'rankings': rankings,
    'totalParticipants': len(players),
    'updatedAt': '2026-04-21T02:20:00Z' # 仮のタイムスタンプ
}

with open(output_file, 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

print(f"Processed {len(players)} players. Top ranking saved to {output_file}")
target = [p for p in players if p['uid'] == '5nSNAtHGA0dVIB47VTAzrXambK63']
if target:
    print(f"Validation: 南茂蘭蘭's score = {target[0]['totalScore']}")
