// Publishes ./dist to the gh-pages branch using a temporary git worktree/repo
// so main stays clean without build artifacts.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const distDir = path.resolve('dist');
if (!fs.existsSync(distDir)) {
  throw new Error('dist/ not found. Run "npm run build" first.');
}

const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
  encoding: 'utf8',
}).trim();

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skpxr-gh-pages-'));
try {
  fs.cpSync(distDir, tmpDir, { recursive: true });
  const run = (args) => execFileSync('git', args, { cwd: tmpDir, stdio: 'inherit' });
  run(['init', '-b', 'gh-pages']);
  run(['add', '-A']);
  run(['commit', '-m', `Deploy SkpXR PWA (${new Date().toISOString()})`]);
  run(['remote', 'add', 'origin', remoteUrl]);
  run(['push', '-f', 'origin', 'gh-pages']);
  console.log('Successfully pushed dist/ to origin/gh-pages');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
