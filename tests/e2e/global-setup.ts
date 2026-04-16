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

/**
 * Firebase Auth エミュレータにユーザーを作成し、UID を返す。
 * すでに存在する場合はそのままサインインして UID を返す。
 */
async function createAuthUser(
  projectId: string,
  email: string,
  password: string,
  displayName: string
): Promise<string | null> {
  const signUpUrl = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key`;
  const maxRetries = 5;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(signUpUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, displayName, returnSecureToken: true }),
      });
      const json: any = await res.json();

      if (res.ok) {
        return json.localId as string;
      }

      // すでに存在する場合はサインインして UID を取得
      if (json?.error?.message === 'EMAIL_EXISTS') {
        const signInRes = await fetch(
          `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, returnSecureToken: true }),
          }
        );
        const signInJson: any = await signInRes.json();
        if (signInRes.ok) return signInJson.localId as string;
      }

      console.warn(`createAuthUser attempt ${i + 1} failed:`, json?.error?.message);
    } catch (e: any) {
      console.warn(`createAuthUser attempt ${i + 1} error:`, e.message);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

/**
 * Firebase Auth エミュレータの管理 API でカスタムクレームを設定する。
 */
async function setCustomClaims(projectId: string, localId: string, claims: Record<string, unknown>) {
  // Firebase Auth エミュレータ専用エンドポイント
  const url = `http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts/${localId}`;
  const maxRetries = 5;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customClaims: JSON.stringify(claims) }),
      });
      if (res.ok) return;
      const text = await res.text();
      console.warn(`setCustomClaims attempt ${i + 1} failed:`, text);
    } catch (e: any) {
      console.warn(`setCustomClaims attempt ${i + 1} error:`, e.message);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

async function globalSetup(config: FullConfig) {
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true') {
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'math-app-26c77';
    console.log('Seeding emulator with test unit and ranking data...');

    try {
      // =====================================================================
      // 1. 1問ユニット（既存テストとの互換 + 復習モードテスト用）
      // =====================================================================
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
                    options: { arrayValue: { values: [{ stringValue: '2' }, { stringValue: '1' }] } },
                    answer_index: { integerValue: 1 },
                    explanation: { stringValue: '1+1=2' }
                  }
                }
              }
            ]
          }
        }
      });

      // =====================================================================
      // 2. 1問ユニット2（全問正解テスト用）
      // =====================================================================
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
                    options: { arrayValue: { values: [{ stringValue: '4' }, { stringValue: '3' }] } },
                    answer_index: { integerValue: 1 },
                    explanation: { stringValue: '2+2=4' }
                  }
                }
              }
            ]
          }
        }
      });

      // =====================================================================
      // 3. 複数問題ユニット（スコアバリエーション・ナビゲーションテスト用）
      //    3問構成。正解テキスト: "2", "4", "6"。不正解テキスト: "99"
      // =====================================================================
      await patchDoc(projectId, 'units', 'test_unit_multi', {
        id: { stringValue: 'test_unit_multi' },
        title: { stringValue: 'テスト複数問題単元' },
        category: { stringValue: '1.正の数と負の数' },
        subject: { stringValue: '数学' },
        questions: {
          arrayValue: {
            values: [
              {
                mapValue: {
                  fields: {
                    id: { stringValue: 'mq1' },
                    question_text: { stringValue: '1+1' },
                    options: { arrayValue: { values: [{ stringValue: '2' }, { stringValue: '99' }] } },
                    answer_index: { integerValue: 1 },
                    explanation: { stringValue: '1+1=2' }
                  }
                }
              },
              {
                mapValue: {
                  fields: {
                    id: { stringValue: 'mq2' },
                    question_text: { stringValue: '2+2' },
                    options: { arrayValue: { values: [{ stringValue: '4' }, { stringValue: '99' }] } },
                    answer_index: { integerValue: 1 },
                    explanation: { stringValue: '2+2=4' }
                  }
                }
              },
              {
                mapValue: {
                  fields: {
                    id: { stringValue: 'mq3' },
                    question_text: { stringValue: '3+3' },
                    options: { arrayValue: { values: [{ stringValue: '6' }, { stringValue: '99' }] } },
                    answer_index: { integerValue: 1 },
                    explanation: { stringValue: '3+3=6' }
                  }
                }
              }
            ]
          }
        }
      });

      // =====================================================================
      // 4. シードスコア（ランキング表示テスト用）
      // =====================================================================
      await patchDoc(projectId, 'scores', 'test-user-a_test_unit', {
        uid: { stringValue: 'test-user-a' },
        unitId: { stringValue: 'test_unit' },
        userName: { stringValue: 'テスト君A (Seed)' },
        maxScore: { integerValue: 100 },
        bestTime: { integerValue: 10 },
        totalCorrect: { integerValue: 10 },
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
        totalCorrect: { integerValue: 5 },
        icon: { stringValue: '🥇' },
        level: { integerValue: 5 },
        updatedAt: { stringValue: new Date().toISOString() }
      });

      await patchDoc(projectId, 'scores', 'test-user-b_test_unit', {
        uid: { stringValue: 'test-user-b' },
        unitId: { stringValue: 'test_unit' },
        userName: { stringValue: 'テストちゃんB (Seed)' },
        maxScore: { integerValue: 80 },
        bestTime: { integerValue: 15 },
        totalCorrect: { integerValue: 8 },
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
        totalCorrect: { integerValue: 9 },
        icon: { stringValue: '🥈' },
        level: { integerValue: 3 },
        updatedAt: { stringValue: new Date().toISOString() }
      });

      // =====================================================================
      // 5. シードユーザーの leaderboards/overall エントリ
      //    テストユーザーのドリル完了後に "You" バッジを確認するためのベースデータ
      // =====================================================================
      await patchDoc(projectId, 'leaderboards', 'overall', {
        rankings: {
          arrayValue: {
            values: [
              {
                mapValue: {
                  fields: {
                    uid: { stringValue: 'test-user-b' },
                    name: { stringValue: 'テストちゃんB (Seed)' },
                    totalScore: { integerValue: 175 },
                    xp: { integerValue: 500 },
                    icon: { stringValue: '🥈' },
                    level: { integerValue: 3 }
                  }
                }
              },
              {
                mapValue: {
                  fields: {
                    uid: { stringValue: 'test-user-a' },
                    name: { stringValue: 'テスト君A (Seed)' },
                    totalScore: { integerValue: 150 },
                    xp: { integerValue: 300 },
                    icon: { stringValue: '🥇' },
                    level: { integerValue: 5 }
                  }
                }
              }
            ]
          }
        },
        totalParticipants: { integerValue: 2 },
        updatedAt: { stringValue: new Date().toISOString() }
      });

      // =====================================================================
      // 6. 管理者ユーザーの作成（admin.spec.ts 用）
      // =====================================================================
      console.log('Creating admin test user...');
      const adminUid = await createAuthUser(
        projectId,
        'admin@shibaurafzk.com',
        'admin-test-password',
        'テスト管理者'
      );

      if (adminUid) {
        // カスタムクレーム設定
        await setCustomClaims(projectId, adminUid, { admin: true });

        // Firestore ユーザードキュメント作成
        await patchDoc(projectId, 'users', adminUid, {
          uid: { stringValue: adminUid },
          email: { stringValue: 'admin@shibaurafzk.com' },
          displayName: { stringValue: 'テスト管理者' },
          xp: { integerValue: 0 },
          icon: { stringValue: '📐' },
          isAdmin: { booleanValue: true },
          hasAgreedToTerms: { booleanValue: true },
          createdAt: { stringValue: new Date().toISOString() },
          lastLoginAt: { stringValue: new Date().toISOString() }
        });
        console.log(`Admin user created: ${adminUid}`);
      } else {
        console.warn('Failed to create admin user. admin.spec.ts tests may fail.');
      }

      console.log('Emulator seeded successfully.');
    } catch (e) {
      console.error('Emulator seeding error:', e);
    }
  }
}

export default globalSetup;
