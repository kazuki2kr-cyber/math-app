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
  console.error('❌ Java が見つかりません。');
  process.exit(1);
}

const env = Object.assign({}, process.env, {
  JAVA_HOME: javaHome,
  PATH: path.join(javaHome, 'bin') + path.delimiter + process.env.PATH,
});

const projectRoot = path.join(__dirname, '..');
const firebaseBin = path.join(projectRoot, 'node_modules', '.bin', 'firebase.cmd');

console.log('🔥 Security Rules テスト実行中...');

const result = spawnSync(
  `"${firebaseBin}"`,
  ['emulators:exec', '"npm run test:security"'],
  {
    cwd: projectRoot,
    env: env,
    stdio: 'inherit',
    shell: true,
  }
);

process.exit(result.status || 1);
