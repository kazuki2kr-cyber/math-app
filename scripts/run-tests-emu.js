const { spawnSync } = require('child_process');
const path = require('path');
const { buildFirebaseEnv } = require('./firebase-emulator-env');

const projectRoot = path.join(__dirname, '..');

const firebaseBin = path.join(projectRoot, 'node_modules', '.bin', 'firebase.cmd');
let env;
try {
  env = buildFirebaseEnv(projectRoot);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

console.log(`JAVA_HOME: ${env.JAVA_HOME}`);
console.log('Running Jest with Firebase Emulator...');

const result = spawnSync(
  `"${firebaseBin}"`,
  [
    'emulators:exec',
    '--project',
    'math-app-26c77',
    '--only',
    'auth,functions,firestore,database,hosting',
    '"npm run test:jest"',
  ],
  {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
    shell: true,
  }
);

process.exit(result.status ?? 1);
