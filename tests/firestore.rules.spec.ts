import {
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import * as fs from 'fs';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'math-app-26c77',
    firestore: {
      rules: fs.readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe('Firestore Security Rules', () => {
  const aliceId = 'alice';
  const bobId = 'bob';
  const adminId = 'admin';

  // ─────────────────────────────────────────────────────
  // users コレクション
  // ─────────────────────────────────────────────────────

  test('ユーザーは自分のプロフィールを読み取れる', async () => {
    const aliceContext = testEnv.authenticatedContext(aliceId);
    const aliceRef = doc(aliceContext.firestore(), 'users', aliceId);

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', aliceId), {
        uid: aliceId,
        displayName: 'Alice',
        xp: 0,
        isAdmin: false,
      });
    });

    await expect(getDoc(aliceRef)).resolves.toBeDefined();
  });

  test('ユーザーは他ユーザーのプロフィールを読み取れない', async () => {
    const aliceContext = testEnv.authenticatedContext(aliceId);
    const bobRef = doc(aliceContext.firestore(), 'users', bobId);

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', bobId), {
        uid: bobId,
        displayName: 'Bob',
        xp: 100,
      });
    });

    await expect(getDoc(bobRef)).rejects.toThrow();
  });

  test('未認証ユーザーはユーザープロフィールを読み取れない', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', aliceId), {
        uid: aliceId,
        displayName: 'Alice',
      });
    });

    const anonContext = testEnv.unauthenticatedContext();
    const ref = doc(anonContext.firestore(), 'users', aliceId);
    await expect(getDoc(ref)).rejects.toThrow();
  });

  test('ユーザーは icon / hasAgreedToTerms / lastLoginAt のみ更新できる', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', aliceId), {
        uid: aliceId,
        displayName: 'Alice',
        icon: '📐',
        xp: 10,
        isAdmin: false,
        hasAgreedToTerms: false,
        lastLoginAt: new Date().toISOString(),
      });
    });

    const aliceContext = testEnv.authenticatedContext(aliceId);
    const aliceRef = doc(aliceContext.firestore(), 'users', aliceId);

    // 許可フィールドのみ → 成功
    await expect(updateDoc(aliceRef, { icon: '🚀' })).resolves.toBeUndefined();
  });

  test('ユーザーは displayName を直接更新できない（許可フィールド外）', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', aliceId), {
        uid: aliceId,
        displayName: 'Alice',
        icon: '📐',
        xp: 10,
        isAdmin: false,
      });
    });

    const aliceContext = testEnv.authenticatedContext(aliceId);
    const aliceRef = doc(aliceContext.firestore(), 'users', aliceId);

    // displayName は許可リストにない → 失敗
    await expect(updateDoc(aliceRef, { displayName: 'Hacked' })).rejects.toThrow();
  });

  test('ユーザーは自分の XP を直接更新できない', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', aliceId), {
        uid: aliceId,
        xp: 10,
      });
    });

    const aliceContext = testEnv.authenticatedContext(aliceId);
    const aliceRef = doc(aliceContext.firestore(), 'users', aliceId);
    await expect(updateDoc(aliceRef, { xp: 9999 })).rejects.toThrow();
  });

  // ─────────────────────────────────────────────────────
  // users サブコレクション（attempts / wrong_answers）
  // ─────────────────────────────────────────────────────

  test('クライアントは attempts サブコレクションに書き込めない（Cloud Functions のみ）', async () => {
    const aliceContext = testEnv.authenticatedContext(aliceId);
    const attemptRef = doc(
      aliceContext.firestore(),
      'users',
      aliceId,
      'attempts',
      'attempt1'
    );

    await expect(
      setDoc(attemptRef, { score: 100, unitId: 'test' })
    ).rejects.toThrow();
  });

  test('クライアントは wrong_answers サブコレクションに書き込めない（Cloud Functions のみ）', async () => {
    const aliceContext = testEnv.authenticatedContext(aliceId);
    const wrongRef = doc(
      aliceContext.firestore(),
      'users',
      aliceId,
      'wrong_answers',
      'unit1'
    );

    await expect(
      setDoc(wrongRef, { ids: ['q1', 'q2'] })
    ).rejects.toThrow();
  });

  test('ユーザーは自分の attempts を読み取れる', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'users', aliceId, 'attempts', 'attempt1'),
        { score: 80, unitId: 'test' }
      );
    });

    const aliceContext = testEnv.authenticatedContext(aliceId);
    const attemptRef = doc(
      aliceContext.firestore(),
      'users',
      aliceId,
      'attempts',
      'attempt1'
    );

    await expect(getDoc(attemptRef)).resolves.toBeDefined();
  });

  // ─────────────────────────────────────────────────────
  // leaderboards
  // ─────────────────────────────────────────────────────

  test('認証済みユーザーはリーダーボードを読み取れる', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'leaderboards', 'overall'), {
        rankings: [],
      });
    });

    const aliceContext = testEnv.authenticatedContext(aliceId);
    const ref = doc(aliceContext.firestore(), 'leaderboards', 'overall');
    await expect(getDoc(ref)).resolves.toBeDefined();
  });

  test('未認証ユーザーはリーダーボードを読み取れない', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'leaderboards', 'overall'), {
        rankings: [],
      });
    });

    const anonContext = testEnv.unauthenticatedContext();
    const ref = doc(anonContext.firestore(), 'leaderboards', 'overall');
    await expect(getDoc(ref)).rejects.toThrow();
  });

  test('クライアントはリーダーボードに書き込めない（Cloud Functions のみ）', async () => {
    const aliceContext = testEnv.authenticatedContext(aliceId);
    const ref = doc(aliceContext.firestore(), 'leaderboards', 'overall');
    await expect(setDoc(ref, { rankings: [] })).rejects.toThrow();
  });

  // ─────────────────────────────────────────────────────
  // scores コレクション（認証済みユーザーは読み取り可）
  // ─────────────────────────────────────────────────────

  test('認証済みユーザーはスコアを読み取れる（ランキング表示用）', async () => {
    const aliceContext = testEnv.authenticatedContext(aliceId);
    const scoreRef = doc(aliceContext.firestore(), 'scores', 'score123');
    await expect(getDoc(scoreRef)).resolves.toBeDefined();
  });

  test('クライアントはスコアに直接書き込めない', async () => {
    const aliceContext = testEnv.authenticatedContext(aliceId);
    const scoreRef = doc(aliceContext.firestore(), 'scores', 'newScore');
    await expect(
      setDoc(scoreRef, { uid: aliceId, score: 100 })
    ).rejects.toThrow();
  });

  // ─────────────────────────────────────────────────────
  // units コレクション
  // ─────────────────────────────────────────────────────

  test('認証済みユーザーは units を読み取れる', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'units', 'unit1'), {
        title: 'テスト単元',
      });
    });

    const aliceContext = testEnv.authenticatedContext(aliceId);
    const ref = doc(aliceContext.firestore(), 'units', 'unit1');
    await expect(getDoc(ref)).resolves.toBeDefined();
  });

  test('一般ユーザーは units に書き込めない', async () => {
    const aliceContext = testEnv.authenticatedContext(aliceId);
    const ref = doc(aliceContext.firestore(), 'units', 'unit1');
    await expect(setDoc(ref, { title: 'ハック' })).rejects.toThrow();
  });

  test('管理者は units に書き込める', async () => {
    const adminContext = testEnv.authenticatedContext(adminId, { admin: true });
    const ref = doc(adminContext.firestore(), 'units', 'unit1');
    await expect(
      setDoc(ref, { title: '管理者が作成したユニット' })
    ).resolves.toBeUndefined();
  });

  // ─────────────────────────────────────────────────────
  // suspicious_activities
  // ─────────────────────────────────────────────────────

  test('一般ユーザーは suspicious_activities を読み取れない', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'suspicious_activities', 'act1'), {
        uid: aliceId,
        reasons: ['高速回答'],
      });
    });

    const aliceContext = testEnv.authenticatedContext(aliceId);
    const ref = doc(aliceContext.firestore(), 'suspicious_activities', 'act1');
    await expect(getDoc(ref)).rejects.toThrow();
  });

  test('管理者は suspicious_activities を読み取れる', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'suspicious_activities', 'act1'), {
        uid: aliceId,
        reasons: ['高速回答'],
      });
    });

    const adminContext = testEnv.authenticatedContext(adminId, { admin: true });
    const ref = doc(adminContext.firestore(), 'suspicious_activities', 'act1');
    await expect(getDoc(ref)).resolves.toBeDefined();
  });

  test('クライアントは suspicious_activities に直接書き込めない', async () => {
    const aliceContext = testEnv.authenticatedContext(aliceId);
    const ref = doc(aliceContext.firestore(), 'suspicious_activities', 'act1');
    await expect(setDoc(ref, { uid: aliceId })).rejects.toThrow();
  });

  // ─────────────────────────────────────────────────────
  // config/maintenance（全ユーザー読み取り可）
  // ─────────────────────────────────────────────────────

  test('未認証ユーザーも config/maintenance を読み取れる', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'config', 'maintenance'), {
        enabled: false,
      });
    });

    const anonContext = testEnv.unauthenticatedContext();
    const ref = doc(anonContext.firestore(), 'config', 'maintenance');
    await expect(getDoc(ref)).resolves.toBeDefined();
  });

  test('一般ユーザーは config/maintenance に書き込めない', async () => {
    const aliceContext = testEnv.authenticatedContext(aliceId);
    const ref = doc(aliceContext.firestore(), 'config', 'maintenance');
    await expect(setDoc(ref, { enabled: true })).rejects.toThrow();
  });

  test('管理者は config/maintenance に書き込める', async () => {
    const adminContext = testEnv.authenticatedContext(adminId, { admin: true });
    const ref = doc(adminContext.firestore(), 'config', 'maintenance');
    await expect(
      setDoc(ref, { enabled: false, message: '' })
    ).resolves.toBeUndefined();
  });

  // ─────────────────────────────────────────────────────
  // 管理者横断権限テスト
  // ─────────────────────────────────────────────────────

  test('管理者は任意のユーザープロフィールを読み取れる', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', aliceId), {
        uid: aliceId,
        displayName: 'Alice',
      });
    });

    const adminContext = testEnv.authenticatedContext(adminId, { admin: true });
    const aliceRef = doc(adminContext.firestore(), 'users', aliceId);
    await expect(getDoc(aliceRef)).resolves.toBeDefined();
  });
});
