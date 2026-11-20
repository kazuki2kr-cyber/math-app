import * as path from 'node:path';

describe('runCleanupStep isolation', () => {
  test('continues subsequent cleanup steps when an earlier step fails and records the failure', async () => {
    const functionsRoot = path.resolve(__dirname, '../../../functions');
    const adminModule = require.resolve('firebase-admin', { paths: [functionsRoot] });
    jest.doMock(adminModule, () => ({
      firestore: () => ({}),
      database: () => ({}),
    }));

    try {
      const { runCleanupStep } = require('../../../functions/src/cleanup');
      const failures: Array<{ label: string; error: string }> = [];

      const count1 = await runCleanupStep(
        'users/*/attempts',
        async () => {
          throw new Error('FAILED_PRECONDITION: missing index');
        },
        failures
      );
      const count2 = await runCleanupStep(
        'analytics_events',
        async () => 42,
        failures
      );

      expect(count1).toBe(0);
      expect(count2).toBe(42);
      expect(failures).toEqual([
        { label: 'users/*/attempts', error: 'FAILED_PRECONDITION: missing index' },
      ]);
    } finally {
      jest.dontMock(adminModule);
      jest.resetModules();
    }
  });
});
