import { execFileSync } from "node:child_process";

const MAX_STAGED_FILE_BYTES = 50 * 1024 * 1024;

const forbiddenPathPatterns = [
  /(^|\/)\.tmp\.driveupload(\/|$)/,
  /(^|\/)\.next(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)functions\/lib(\/|$)/,
  /(^|\/)coverage(\/|$)/,
  /(^|\/)playwright-report(\/|$)/,
  /(^|\/)test-results(\/|$)/,
];

function git(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function stagedPaths() {
  const output = git([
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACMR",
    "-z",
  ]);

  return output.split("\0").filter(Boolean);
}

function stagedBlobSize(path) {
  const output = git(["cat-file", "-s", `:${path}`]);
  return Number.parseInt(output.trim(), 10);
}

function formatMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

const violations = [];

for (const path of stagedPaths()) {
  if (forbiddenPathPatterns.some((pattern) => pattern.test(path))) {
    violations.push(`${path}: 一時ファイルまたは再生成可能な生成物です`);
    continue;
  }

  const size = stagedBlobSize(path);
  if (size > MAX_STAGED_FILE_BYTES) {
    violations.push(
      `${path}: ${formatMiB(size)}（上限 ${formatMiB(MAX_STAGED_FILE_BYTES)}）`,
    );
  }
}

if (violations.length > 0) {
  console.error("コミットを中止しました。不要な巨大ファイルの混入を確認してください。");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  console.error(
    "意図した大容量ファイルの場合は、Git LFSや外部ストレージの利用を検討してください。",
  );
  process.exit(1);
}
