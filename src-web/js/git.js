// isomorphic-git operations (browser CORS works with github.com git endpoints)
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import { capfs } from './capfs.js';

export const FILTER = (p) =>
  !p.startsWith('public/') &&
  !p.startsWith('resources/') &&
  !p.startsWith('.git') &&
  !p.endsWith('.hugo_build.lock') &&
  !p.startsWith('node_modules/');

export async function gitInit(dir) {
  await git.init({ fs: capfs, dir, defaultBranch: 'main' });
}

export async function statusRows(dir) {
  return git.statusMatrix({ fs: capfs, dir, filter: FILTER });
}

export async function commitAll(dir, message, author) {
  const rows = await statusRows(dir);
  let staged = 0;
  for (const [file, head, workdir, stage] of rows) {
    if (head === workdir && workdir === stage) continue; // no change
    if (head !== 0 && workdir === 0) {
      await git.remove({ fs: capfs, dir, filepath: file });
    } else {
      await git.add({ fs: capfs, dir, filepath: file });
    }
    staged++;
  }
  if (!staged) return { staged: 0, sha: null };
  const sha = await git.commit({ fs: capfs, dir, message, author });
  return { staged, sha };
}

export async function setRemote(dir, url) {
  try { await git.deleteRemote({ fs: capfs, dir, remote: 'origin' }); } catch { /* not exist */ }
  await git.addRemote({ fs: capfs, dir, remote: 'origin', url });
}

export async function currentBranch(dir) {
  try { return await git.currentBranch({ fs: capfs, dir, fullname: false }); }
  catch { return null; }
}

export async function pushTo(dir, { url, ref, username, password }) {
  await git.push({
    fs: capfs, http, dir,
    remote: 'origin', url, ref,
    onAuth: () => ({ username, password }),
  });
}

export async function cloneRepo(dir, url) {
  await git.clone({ fs: capfs, http, dir, url, depth: 1, singleBranch: true });
}
