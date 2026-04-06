// tests/e2e/global-setup.ts
import { FullConfig } from '@playwright/test';

async function patchDoc(projectId: string, collection: string, docId: string, fields: any) {
  const response = await fetch(`http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents/${collection}/${docId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer owner'
    },
    body: JSON.stringify({ fields })
  });
  if (!response.ok) {
    console.error(`Failed to seed ${collection}/${docId}:`, await response.text());
  }
}

async function globalSetup(config: FullConfig) {
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true') {
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'math-app-26c77';
    console.log('Seeding emulator with test unit and ranking data...');
    
    try {
      // 1. Seed Unit
      await patchDoc(projectId, 'units', 'test_unit', {
        id: { stringValue: 'test_unit' },
        title: { stringValue: 'テスト単元' },
        category: { stringValue: '1.正の数と負の数' },
        subject: { stringValue: '数学' },
        questions: {
          arrayValue: {
            values: [
              {
                mapValue: {
                  fields: {
                    id: { stringValue: 'q1' },
                    question_text: { stringValue: '1+1' },
                    options: { arrayValue: { values: [{ stringValue: '1' }, { stringValue: '2' }] } },
                    answer_index: { integerValue: 2 },
                    explanation: { stringValue: '1+1=2' }
                  }
                }
              }
            ]
          }
        }
      });

      // 1-2. Seed Unit 2
      await patchDoc(projectId, 'units', 'test_unit_2', {
        id: { stringValue: 'test_unit_2' },
        title: { stringValue: 'テスト単元2' },
        category: { stringValue: '1.正の数と負の数' },
        subject: { stringValue: '数学' },
        questions: {
          arrayValue: {
            values: [
              {
                mapValue: {
                  fields: {
                    id: { stringValue: 'q2' },
                    question_text: { stringValue: '2+2' },
                    options: { arrayValue: { values: [{ stringValue: '3' }, { stringValue: '4' }] } },
                    answer_index: { integerValue: 2 },
                    explanation: { stringValue: '2+2=4' }
                  }
                }
              }
            ]
          }
        }
      });

      // 2. Seed Scores (User A: 100 on test_unit, 50 on test_unit_2 => 150)
      await patchDoc(projectId, 'scores', 'test-user-a_test-unit', {
        uid: { stringValue: 'test-user-a' },
        unitId: { stringValue: 'test_unit' },
        userName: { stringValue: 'テスト君A (Seed)' },
        maxScore: { integerValue: 100 },
        bestTime: { integerValue: 10 },
        icon: { stringValue: '🥇' },
        level: { integerValue: 5 },
        updatedAt: { stringValue: new Date().toISOString() }
      });
      await patchDoc(projectId, 'scores', 'test-user-a_test-unit-2', {
        uid: { stringValue: 'test-user-a' },
        unitId: { stringValue: 'test_unit_2' },
        userName: { stringValue: 'テスト君A (Seed)' },
        maxScore: { integerValue: 50 },
        bestTime: { integerValue: 20 },
        icon: { stringValue: '🥇' },
        level: { integerValue: 5 },
        updatedAt: { stringValue: new Date().toISOString() }
      });

      // 3. Seed Scores (User B: 80 on test_unit, 95 on test_unit_2 => 175)
      await patchDoc(projectId, 'scores', 'test-user-b_test-unit', {
        uid: { stringValue: 'test-user-b' },
        unitId: { stringValue: 'test_unit' },
        userName: { stringValue: 'テストちゃんB (Seed)' },
        maxScore: { integerValue: 80 },
        bestTime: { integerValue: 15 },
        icon: { stringValue: '🥈' },
        level: { integerValue: 3 },
        updatedAt: { stringValue: new Date().toISOString() }
      });
      await patchDoc(projectId, 'scores', 'test-user-b_test-unit-2', {
        uid: { stringValue: 'test-user-b' },
        unitId: { stringValue: 'test_unit_2' },
        userName: { stringValue: 'テストちゃんB (Seed)' },
        maxScore: { integerValue: 95 },
        bestTime: { integerValue: 15 },
        icon: { stringValue: '🥈' },
        level: { integerValue: 3 },
        updatedAt: { stringValue: new Date().toISOString() }
      });

      console.log('Emulator seeded successfully.');
    } catch (e) {
      console.error('Emulator seeding error:', e);
    }
  }
}

export default globalSetup;
