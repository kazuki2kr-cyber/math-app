import json

def process_users():
    with open('c:/Users/ichikawa/.gemini/antigravity/brain/cf33d03e-a527-4db6-906d-ee4f4e07bd14/.system_generated/steps/934/output.txt', 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    users = []
    for doc in data.get('documents', []):
        fields = doc.get('fields', {})
        
        # Extract fields safely
        displayName = fields.get('displayName', {}).get('stringValue', 'Unknown')
        totalScore = int(fields.get('totalScore', {}).get('integerValue', 0))
        xp = int(fields.get('xp', {}).get('integerValue', 0))
        level = int(fields.get('level', {}).get('integerValue', 1))
        icon = fields.get('icon', {}).get('stringValue', '📐')
        title = fields.get('title', {}).get('stringValue', '算数卒業生')
        
        users.append({
            'displayName': displayName,
            'totalScore': totalScore,
            'xp': xp,
            'level': level,
            'icon': icon,
            'title': title
        })
    
    # Sort by totalScore DESC, then xp DESC
    users.sort(key=lambda x: (x['totalScore'], x['xp']), reverse=True)
    
    top_40 = users[:40]
    
    with open('c:/Users/ichikawa/Desktop/math.app/scratch/top_40.json', 'w', encoding='utf-8') as f:
        json.dump(top_40, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    process_users()
