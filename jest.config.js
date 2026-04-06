module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/tests/e2e/'],
};
