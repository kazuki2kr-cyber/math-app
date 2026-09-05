module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.spec.ts'],
  testPathIgnorePatterns: [
    '/node_modules/', '/tests/e2e/',
    // These suites need Functions + RTDB and isolated fixtures. Run explicitly
    // with test:kanji-battle, not alongside suites that clear all Firestore data.
    ...(process.env.KANJI_BATTLE_INTEGRATION === '1' ? [] : ['/tests/kanji-battle.*integration.spec.ts']),
  ],
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.jest.json',
    },
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
