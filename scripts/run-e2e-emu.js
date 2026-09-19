#!/usr/bin/env node
/**
 * E2Eテスト実行ヘルパー
 * 1. JAVA_HOME / PATH を自動検出・設定
 * 2. NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true を設定
 * 3. firebase emulators:exec "npx playwright test" を実行
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { buildFirebaseEnv } = require('./firebase-emulator-env');

const projectRoot = path.join(__dirname, '..');
let env;
try {
  env = buildFirebaseEnv(projectRoot);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR = 'true';

console.log(`☕ JAVA_HOME: ${env.JAVA_HOME}`);

// --- Java バージョン確認 ---
const javaExecutable = path.join(
  env.JAVA_HOME,
  'bin',
  process.platform === 'win32' ? 'java.exe' : 'java'
);
const javaVersion = spawnSync(javaExecutable, ['--version'], {
  encoding: 'utf8',
});
console.log(`☕ Java version: ${(javaVersion.stdout || javaVersion.stderr || '').split('\n')[0]}`);

// --- firebase emulators:exec を実行 ---
console.log('🔥 Firebase Emulators + Playwright テストを起動中...');

const firebaseBin = path.join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'firebase.cmd' : 'firebase'
);
const testTargets = process.argv.slice(2);
const playwrightCommand = ['npx playwright test', ...testTargets].join(' ');
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

console.log('🔨 Cloud Functions をビルド中...');
const functionsBuild = spawnSync(
  npmBin,
  ['--prefix', 'functions', 'run', 'build'],
  {
    cwd: projectRoot,
    env: env,
    stdio: 'inherit',
    shell: true,
  }
);

if (functionsBuild.status !== 0) {
  console.error('❌ Cloud Functions のビルドに失敗しました');
  process.exit(functionsBuild.status || 1);
}

const result = spawnSync(
  `"${firebaseBin}"`,
  [
    'emulators:exec',
    '--project',
    'math-app-26c77',
    '--only',
    'auth,functions,firestore,database',
    `"${playwrightCommand}"`,
  ],
  {
    cwd: projectRoot,
    env: env,
    stdio: 'inherit',
    shell: true,
  }
);

if (result.status === 0) {
  console.log('✅ E2Eテスト完了');
} else {
  console.error('❌ E2Eテスト失敗 (exit code:', result.status, ')');
  if (result.error) {
    console.error('Error:', result.error.message);
  }
  process.exit(result.status || 1);
}
