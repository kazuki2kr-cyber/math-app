import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { getMetadata, ref, uploadBytes } from 'firebase/storage';
import * as fs from 'fs';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'math-app-26c77',
    storage: { rules: fs.readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
  });
});

afterAll(async () => { await testEnv?.cleanup(); });

test('答案画像は生徒・管理者のブラウザSDKから直接読めず書けない', async () => {
  for (const context of [
    testEnv.unauthenticatedContext(),
    testEnv.authenticatedContext('student', { email: 'student@shibaurafzk.com' }),
    testEnv.authenticatedContext('admin', { admin: true }),
  ]) {
    const answer = ref(context.storage('gs://math-app-26c77.firebasestorage.app'), 'written-archive/v1/images/student/a1.png');
    await expect(getMetadata(answer)).rejects.toThrow();
    await expect(uploadBytes(answer, new Uint8Array([1, 2, 3]))).rejects.toThrow();
  }
});
