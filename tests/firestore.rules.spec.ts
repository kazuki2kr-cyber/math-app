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

  test('Users can read their own profile', async () => {
    const aliceContext = testEnv.authenticatedContext(aliceId);
    const aliceDb = aliceContext.firestore();
    const aliceRef = doc(aliceDb, 'users', aliceId);

    // Initial setup with unauthenticated context (simulating admin/initial state)
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', aliceId), {
        uid: aliceId,
        displayName: 'Alice',
        xp: 0,
        isAdmin: false
      });
    });

    await expect(getDoc(aliceRef)).resolves.toBeDefined();
  });

  test('Users cannot read other users profiles', async () => {
    const aliceContext = testEnv.authenticatedContext(aliceId);
    const aliceDb = aliceContext.firestore();
    const bobRef = doc(aliceDb, 'users', bobId);

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', bobId), {
        uid: bobId,
        displayName: 'Bob',
        xp: 100
      });
    });

    await expect(getDoc(bobRef)).rejects.toThrow();
  });

  test('Anyone can read rankings (scores)', async () => {
    const aliceContext = testEnv.authenticatedContext(aliceId);
    const scoreRef = doc(aliceContext.firestore(), 'scores', 'score123');

    await expect(getDoc(scoreRef)).resolves.toBeDefined();
  });

  test('Students cannot write to scores directly', async () => {
    const aliceContext = testEnv.authenticatedContext(aliceId);
    const scoreRef = doc(aliceContext.firestore(), 'scores', 'newScore');

    await expect(setDoc(scoreRef, {
      uid: aliceId,
      score: 100,
      timestamp: new Date()
    })).rejects.toThrow();
  });

  test('Users can update their own icon and displayName', async () => {
    const aliceContext = testEnv.authenticatedContext(aliceId);
    const aliceDb = aliceContext.firestore();
    const aliceRef = doc(aliceDb, 'users', aliceId);

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', aliceId), {
        uid: aliceId,
        displayName: 'Alice',
        icon: '📐',
        xp: 10,
        isAdmin: false
      });
    });

    await expect(updateDoc(aliceRef, {
      icon: '🚀',
      displayName: 'Alice Rocket'
    })).resolves.toBeUndefined();
  });

  test('Users cannot update their own XP', async () => {
    const aliceContext = testEnv.authenticatedContext(aliceId);
    const aliceDb = aliceContext.firestore();
    const aliceRef = doc(aliceDb, 'users', aliceId);

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', aliceId), {
        uid: aliceId,
        xp: 10
      });
    });

    await expect(updateDoc(aliceRef, {
      xp: 9999
    })).rejects.toThrow();
  });

  test('Admins can read anything', async () => {
    const adminContext = testEnv.authenticatedContext(adminId, { admin: true });
    const aliceRef = doc(adminContext.firestore(), 'users', aliceId);

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', aliceId), {
        uid: aliceId,
        displayName: 'Alice'
      });
    });

    await expect(getDoc(aliceRef)).resolves.toBeDefined();
  });
});
