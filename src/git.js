'use strict';
// Bir projenin git durumunu özetler (salt okunur; fetch/pull yapmaz).
const { execFile } = require('child_process');

function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { windowsHide: true, timeout: 15000, encoding: 'utf8' },
      (err, stdout) => resolve(err ? null : stdout));
  });
}

/** null = git deposu değil. */
async function gitStatus(cwd) {
  const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (!inside || inside.trim() !== 'true') return null;

  const [branch, status, log, ab] = await Promise.all([
    git(cwd, ['branch', '--show-current']),
    git(cwd, ['status', '--porcelain']),
    git(cwd, ['log', '-5', '--format=%h%x09%ct%x09%s']),
    git(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']),
  ]);

  const lines = (status || '').split('\n').filter(Boolean);
  const untracked = lines.filter((l) => l.startsWith('??')).length;
  let ahead = null;
  let behind = null;
  if (ab) [ahead, behind] = ab.trim().split(/\s+/).map(Number);

  return {
    branch: (branch || '').trim() || '(detached)',
    changed: lines.length - untracked,
    untracked,
    ahead,
    behind,
    commits: (log || '').split('\n').filter(Boolean).map((l) => {
      const [hash, ct, ...msg] = l.split('\t');
      return { hash, time: Number(ct) * 1000, subject: msg.join('\t') };
    }),
  };
}

module.exports = { gitStatus };
