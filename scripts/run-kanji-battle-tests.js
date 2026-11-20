const { spawnSync } = require('child_process');
const path = require('path');
const { buildFirebaseEnv } = require('./firebase-emulator-env');
const projectRoot = path.join(__dirname, '..');
const env = buildFirebaseEnv(projectRoot);
env.KANJI_BATTLE_INTEGRATION = '1';
const npmBinary = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const firebaseBinary = path.join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'firebase.cmd' : 'firebase'
);
const build = spawnSync(npmBinary, ['--prefix', 'functions', 'run', 'build'], {
  cwd: projectRoot, env, shell: true, stdio: 'inherit',
});
if (build.status !== 0) process.exit(build.status ?? 1);
const command = process.argv.includes('--e2e')
  ? 'npx playwright test tests/e2e/kanji-battle.spec.ts --reporter=list'
  : 'npx jest tests/kanji-battle.integration.spec.ts tests/kanji-battle.ocr.integration.spec.ts tests/unit/functions/kanjiBattleState.spec.ts --runInBand';
const result = spawnSync('"' + firebaseBinary + '"', [
  'emulators:exec', '--project', 'math-app-26c77', '--only', 'auth,firestore,database,functions', '"' + command + '"',
], { cwd: projectRoot, env, shell: true, stdio: 'inherit' });
process.exit(result.status ?? 1);
