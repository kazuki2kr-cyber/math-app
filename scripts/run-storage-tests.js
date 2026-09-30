const { spawnSync } = require('child_process');
const path = require('path');
const { buildFirebaseEnv } = require('./firebase-emulator-env');

const root = path.join(__dirname, '..');
const firebaseBin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'firebase.cmd' : 'firebase');
let env;
try { env = buildFirebaseEnv(root); }
catch (error) { console.error(error.message); process.exit(1); }

const result = spawnSync(`"${firebaseBin}"`,
  ['emulators:exec', '--project', 'math-app-26c77', '--only', 'storage', '"npm run test:storage:jest"'],
  { cwd: root, env, stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
