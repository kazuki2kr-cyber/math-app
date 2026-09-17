import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const PACKAGE_FILES = ['package.json', 'package-lock.json'];

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Unsupported package version: ${version}`);
  }

  return match.slice(1).map(Number);
}

function readHeadVersion() {
  try {
    const source = execFileSync('git', ['show', 'HEAD:package.json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(source).version;
  } catch {
    return null;
  }
}

function replaceVersion(source, currentVersion, nextVersion, file) {
  const needle = `"version": "${currentVersion}"`;
  if (!source.includes(needle)) {
    throw new Error(`${file} does not contain the expected version ${currentVersion}`);
  }

  return source.replace(needle, `"version": "${nextVersion}"`);
}

const packageSource = readFileSync('package.json', 'utf8');
const currentVersion = JSON.parse(packageSource).version;
const headVersion = readHeadVersion();

// A failed or cancelled commit leaves the bumped files staged. Do not bump twice
// when the user retries that commit.
if (headVersion && currentVersion !== headVersion) {
  console.log(`Version is already updated (${headVersion} -> ${currentVersion}).`);
  process.exit(0);
}

const [major, minor, patch] = parseVersion(currentVersion);
const nextVersion = `${major}.${minor}.${patch + 1}`;

for (const file of PACKAGE_FILES) {
  const source = readFileSync(file, 'utf8');
  writeFileSync(file, replaceVersion(source, currentVersion, nextVersion, file), 'utf8');
}

console.log(`Version bumped: ${currentVersion} -> ${nextVersion}`);
