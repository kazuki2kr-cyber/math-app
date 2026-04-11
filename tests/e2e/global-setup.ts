// tests/e2e/global-setup.ts
import { FullConfig } from '@playwright/test';

async function patchDoc(projectId: string, collection: string, docId: string, fields: any) {
  const url = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents/${collection}/${docId}?allow_missing=true`;
  const maxRetries = 5;
  let lastError = '';

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer owner' // 管理者権限（ルールバイパス）で投入
        },
        body: JSON.stringify({ fields })
      });

      if (response.ok) {
        return;
      }
      lastError = await response.text();
    } catch (e: any) {
      lastError = e.message;
    }
    // エミュレータの起動待ちを考慮してリトライ
    await new Promise(r => setTimeout(r, 1000));
  }
  console.error(`Failed to seed ${collection}/${docId} after ${maxRetries} attempts:`, lastError);
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
      await patchDoc(projectId, 'scores', 'test-user-a_test_unit', {
        uid: { stringValue: 'test-user-a' },
        unitId: { stringValue: 'test_unit' },
        userName: { stringValue: 'テスト君A (Seed)' },
        maxScore: { integerValue: 100 },
        bestTime: { integerValue: 10 },
        totalCorrect: { integerValue: 10 }, // 追加
        icon: { stringValue: '🥇' },
        level: { integerValue: 5 },
        updatedAt: { stringValue: new Date().toISOString() }
      });
      await patchDoc(projectId, 'scores', 'test-user-a_test_unit_2', {
        uid: { stringValue: 'test-user-a' },
        unitId: { stringValue: 'test_unit_2' },
        userName: { stringValue: 'テスト君A (Seed)' },
        maxScore: { integerValue: 50 },
        bestTime: { integerValue: 20 },
        totalCorrect: { integerValue: 5 }, // 追加
        icon: { stringValue: '🥇' },
        level: { integerValue: 5 },
        updatedAt: { stringValue: new Date().toISOString() }
      });

      // 3. Seed Scores (User B: 80 on test_unit, 95 on test_unit_2 => 175)
      await patchDoc(projectId, 'scores', 'test-user-b_test_unit', {
        uid: { stringValue: 'test-user-b' },
        unitId: { stringValue: 'test_unit' },
        userName: { stringValue: 'テストちゃんB (Seed)' },
        maxScore: { integerValue: 80 },
        bestTime: { integerValue: 15 },
        totalCorrect: { integerValue: 8 }, // 追加
        icon: { stringValue: '🥈' },
        level: { integerValue: 3 },
        updatedAt: { stringValue: new Date().toISOString() }
      });
      await patchDoc(projectId, 'scores', 'test-user-b_test_unit_2', {
        uid: { stringValue: 'test-user-b' },
        unitId: { stringValue: 'test_unit_2' },
        userName: { stringValue: 'テストちゃんB (Seed)' },
        maxScore: { integerValue: 95 },
        bestTime: { integerValue: 15 },
        totalCorrect: { integerValue: 9 }, // 追加
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
