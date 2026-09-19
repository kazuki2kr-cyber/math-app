const { spawnSync } = require('child_process');
const path = require('path');
const { buildFirebaseEnv } = require('./firebase-emulator-env');

const projectRoot = path.join(__dirname, '..');

const firebaseBin = path.join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'firebase.cmd' : 'firebase'
);
let env;
try {
  env = buildFirebaseEnv(projectRoot);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

console.log(`JAVA_HOME: ${env.JAVA_HOME}`);
console.log('Running Security Rules tests with Firebase Emulator...');

const result = spawnSync(
  `"${firebaseBin}"`,
  ['emulators:exec', '--project', 'math-app-26c77', '--only', 'firestore', '"npm run test:security:jest"'],
  {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
    shell: true,
  }
);

process.exit(result.status ?? 1);
