const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function addChildDirectories(candidates, parent, namePattern) {
  if (!parent || !fs.existsSync(parent)) return;

  for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
    if (entry.isDirectory() && namePattern.test(entry.name)) {
      candidates.push(path.join(parent, entry.name));
    }
  }
}

function addJavaFromPath(candidates) {
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(command, ['java'], { encoding: 'utf8' });
  if (result.status !== 0) return;

  for (const javaPath of result.stdout.split(/\r?\n/).filter(Boolean)) {
    candidates.push(path.dirname(path.dirname(javaPath.trim())));
  }
}

function getJavaMajor(javaExe) {
  const result = spawnSync(javaExe, ['--version'], { encoding: 'utf8' });
  const firstLine = (result.stdout || result.stderr || '').split(/\r?\n/)[0] || '';
  const match = firstLine.match(/(?:openjdk|java)\s+([0-9]+)/i);
  return Number(match?.[1] || 0);
}

function findJava21Home() {
  const candidates = [
    process.env.JAVA_HOME,
    'C:\\Program Files\\Microsoft\\jdk-21.0.10.7-hotspot',
    'C:\\Program Files\\Eclipse Adoptium\\jdk-21',
    'C:\\Program Files\\Java\\jdk-21',
  ].filter(Boolean);

  addJavaFromPath(candidates);

  const localPrograms = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Programs')
    : null;
  addChildDirectories(candidates, localPrograms && path.join(localPrograms, 'Eclipse Adoptium'), /^jdk-21/i);
  addChildDirectories(candidates, localPrograms && path.join(localPrograms, 'Microsoft'), /^jdk-21/i);
  addChildDirectories(candidates, 'C:\\Program Files\\Eclipse Adoptium', /^jdk-21/i);
  addChildDirectories(candidates, 'C:\\Program Files\\Microsoft', /^jdk-21/i);

  for (const candidate of [...new Set(candidates)]) {
    const javaExe = path.join(candidate, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (fs.existsSync(javaExe) && getJavaMajor(javaExe) >= 21) {
      return candidate;
    }
  }

  return null;
}

function buildFirebaseEnv(projectRoot) {
  const javaHome = findJava21Home();
  if (!javaHome) {
    throw new Error('Java 21+ was not found. Install JDK 21 or set JAVA_HOME to a JDK 21+ directory.');
  }

  const configHome = path.join(projectRoot, '.tmp', 'firebase-config');
  fs.mkdirSync(configHome, { recursive: true });

  return {
    ...process.env,
    JAVA_HOME: javaHome,
    PATH: path.join(javaHome, 'bin') + path.delimiter + process.env.PATH,
    XDG_CONFIG_HOME: configHome,
    FIREBASE_CLI_DISABLE_UPDATE_CHECK: 'true',
    FUNCTIONS_DISCOVERY_TIMEOUT: '30000',
  };
}

module.exports = {
  buildFirebaseEnv,
  findJava21Home,
};
