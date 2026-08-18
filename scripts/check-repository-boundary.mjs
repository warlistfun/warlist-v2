import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const repository = resolve(process.argv[2] ?? process.cwd());
const forbidden = [
  /(?:^|\/)\.gitmodules$/i,
  /(?:^|\/)\.env[^/]*(?:\/|$)/i,
  /(?:^|\/)(?:ops|auth|sessions|logs|data|baileys|qr|warlist-cache|\.baileys-backup|backup)(?:\/|$)/i,
  /(?:^|\/)uploads\/runtime(?:\/|$)/i,
  /(?:^|\/)node_modules(?:\/|$)/i,
  /(?:^|\/)[^/]+\.(?:db|sqlite)(?:-.+)?$/i,
];

let tracked;
let symlinks;
try {
  tracked = execFileSync('git', ['ls-files', '-z'], {
    cwd: repository,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
  symlinks = execFileSync('git', ['ls-files', '-s', '-z'], {
    cwd: repository,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
    .filter((entry) => entry.startsWith('120000 '))
    .map((entry) => entry.slice(entry.indexOf('\t') + 1));
} catch {
  console.error(`not a readable Git repository: ${repository}`);
  process.exit(1);
}

if (symlinks.length > 0) {
  for (const path of symlinks) {
    console.error(`forbidden tracked symlink: ${path}`);
  }
  process.exit(1);
}

const violations = tracked.filter((path) => forbidden.some((pattern) => pattern.test(path)));
if (violations.length > 0) {
  for (const path of violations) {
    console.error(`forbidden tracked path: ${path}`);
  }
  process.exit(1);
}

console.log(`repository boundary check passed (${tracked.length} tracked paths)`);
