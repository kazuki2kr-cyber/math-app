#!/usr/bin/env node
/**
 * E2Eテスト実行ヘルパー
 * 1. JAVA_HOME / PATH を自動検出・設定
 * 2. NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true を設定
 * 3. firebase emulators:exec "npx playwright test" を実行
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// --- Java 自動検出 ---
const JAVA_CANDIDATES = [
  process.env.JAVA_HOME,
  'C:\\Program Files\\Microsoft\\jdk-21.0.10.7-hotspot',
  'C:\\Program Files\\Microsoft\\jdk-17.0.18.8-hotspot',
  'C:\\Program Files\\Eclipse Adoptium\\jdk-21',
  'C:\\Program Files\\Eclipse Adoptium\\jdk-17',
  'C:\\Program Files\\Java\\jdk-21',
  'C:\\Program Files\\Java\\jdk-17',
];

let javaHome = null;
for (const candidate of JAVA_CANDIDATES) {
  if (candidate && fs.existsSync(path.join(candidate, 'bin', 'java.exe'))) {
    javaHome = candidate;
    break;
  }
}

if (!javaHome) {
  console.error('❌ Java が見つかりません。Java 21以上をインストールしてください。');
  process.exit(1);
}

console.log(`☕ JAVA_HOME: ${javaHome}`);

// --- Java バージョン確認 ---
const javaVersion = spawnSync(path.join(javaHome, 'bin', 'java.exe'), ['--version'], {
  encoding: 'utf8',
});
console.log(`☕ Java version: ${(javaVersion.stdout || javaVersion.stderr || '').split('\n')[0]}`);

// --- 環境変数を構築 ---
const env = Object.assign({}, process.env, {
  JAVA_HOME: javaHome,
  PATH: path.join(javaHome, 'bin') + path.delimiter + process.env.PATH,
  NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true',
});

// --- firebase emulators:exec を実行 ---
console.log('🔥 Firebase Emulators + Playwright テストを起動中...');

const projectRoot = path.join(__dirname, '..');
const firebaseBin = path.join(projectRoot, 'node_modules', '.bin', 'firebase.cmd');

const result = spawnSync(
  `"${firebaseBin}"`,
  ['emulators:exec', '"npx playwright test"'],
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
