import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const changedOnly = process.argv.includes('--changed');

const suspiciousPatterns = [
  '�',
  '縺',
  '繧',
  '繝',
  '譁',
  '謨',
  '郢',
  '陝',
  '荳',
  '笆',
  '',
];

const textExtensions = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.md', '.mdx', '.csv', '.txt', '.css',
  '.html', '.rules',
]);

const defaultTargets = [
  'src',
  'functions/src',
  '.agents',
  '.codex',
  'docs',
];

const ignoredDirs = new Set([
  '.git',
  '.next',
  '.vercel',
  'node_modules',
  'functions/node_modules',
  'functions/lib',
  'out',
  'coverage',
]);

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function shouldSkipPath(filePath) {
  const normalized = normalizePath(filePath);
  if (normalized === 'scripts/check-mojibake.mjs') return true;
  return normalized
    .split('/')
    .some((part, index, parts) => {
      const prefix = parts.slice(0, index + 1).join('/');
      return ignoredDirs.has(part) || ignoredDirs.has(prefix);
    });
}

function isTextFile(filePath) {
  return textExtensions.has(path.extname(filePath).toLowerCase());
}

function collectFiles(targetPath, files = []) {
  if (!existsSync(targetPath) || shouldSkipPath(path.relative(root, targetPath))) return files;

  const info = statSync(targetPath);
  if (info.isDirectory()) {
    for (const entry of readdirSync(targetPath)) {
      collectFiles(path.join(targetPath, entry), files);
    }
    return files;
  }

  if (info.isFile() && isTextFile(targetPath)) {
    files.push(targetPath);
  }
  return files;
}

function collectDefaultFiles() {
  const files = [];
  for (const target of defaultTargets) {
    collectFiles(path.join(root, target), files);
  }

  for (const entry of readdirSync(root)) {
    const absolute = path.join(root, entry);
    if (statSync(absolute).isFile() && ['.csv', '.md', '.json'].includes(path.extname(entry).toLowerCase())) {
      files.push(absolute);
    }
  }

  return [...new Set(files)];
}

function collectChangedFiles() {
  const output = execSync('git diff --name-only --diff-filter=ACMRTUXB HEAD', {
    cwd: root,
    encoding: 'utf8',
  });
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((filePath) => path.join(root, filePath))
    .filter((filePath) => existsSync(filePath) && statSync(filePath).isFile() && isTextFile(filePath))
    .filter((filePath) => !shouldSkipPath(path.relative(root, filePath)));
}

const files = changedOnly ? collectChangedFiles() : collectDefaultFiles();
const findings = [];

for (const filePath of files) {
  const relative = normalizePath(path.relative(root, filePath));
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);

  lines.forEach((line, index) => {
    if (line.includes('mojibake-ok') || lines[index - 1]?.includes('mojibake-ok')) return;
    const matched = suspiciousPatterns.filter((pattern) => line.includes(pattern));
    if (matched.length === 0) return;
    findings.push({
      file: relative,
      line: index + 1,
      matched: [...new Set(matched)].join(', '),
      preview: line.trim().slice(0, 160),
    });
  });
}

if (findings.length > 0) {
  console.error('Potential mojibake was found. If a legacy value is intentional, add "mojibake-ok" on that line.');
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} [${finding.matched}] ${finding.preview}`);
  }
  process.exit(1);
}

console.log(`No mojibake patterns found in ${files.length} text files.`);
