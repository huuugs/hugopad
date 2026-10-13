// node-like fs adapter over Capacitor Filesystem, for isomorphic-git.
// Paths arrive as '/sites/<site>/...' (posix, fs-root relative) — strip leading slash.
import { fsReadBin, fsWriteBin, fsList, fsStat, fsMkdir, fsRmdir, fsUnlink } from './native.js';
import { u8ToB64 } from './util.js';

const strip = (p) => String(p).replace(/^\/+/, '');

const enoent = (p) => { const e = new Error(`ENOENT: no such file or directory, ${p}`); e.code = 'ENOENT'; return e; };

// Promise API
const readFile = async (path) => {
  const b = await fsReadBin(strip(path));
  if (!b) throw enoent(path);
  return b;
};
const writeFile = async (path, data) => {
  const u8 = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  await fsWriteBin(strip(path), u8);
};
const stat = async (path) => {
  const s = await fsStat(strip(path));
  if (!s) throw enoent(path);
  const isDir = s.type === 'directory';
  const t = new Date(s.mtime || 0);
  return {
    isDirectory: () => isDir,
    isFile: () => !isDir,
    size: s.size || 0,
    mtime: t, atime: t, ctime: t, birthtime: t,
    dev: 1, ino: 1, mode: 0o666, nlink: 1, uid: 0, gid: 0, rdev: 0, blksize: 4096, blocks: 1,
  };
};
const readdir = async (path) => (await fsList(strip(path))) || [];
const mkdir = async (path) => { await fsMkdir(strip(path)); };
const rmdir = async (path) => { await fsRmdir(strip(path)); };
const unlink = async (path) => { const ok = await fsUnlink(strip(path)); if (!ok) throw enoent(path); };
const rm = unlink;
const readlink = async () => { const e = new Error('ENOTSUP: readlink'); e.code = 'ENOTSUP'; throw e; };
const symlink = async () => { const e = new Error('ENOTSUP: symlink'); e.code = 'ENOTSUP'; throw e; };

// Dual promise/callback style (isomorphic-git accepts either)
function cbify(fn) {
  return (...args) => {
    const cb = args.length && typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
    const a = cb ? args.slice(0, -1) : args;
    const pr = fn(...a);
    if (cb) pr.then((r) => cb(null, r), (e) => cb(e));
    else return pr;
  };
}

const cbs = {
  readFile: cbify(readFile),
  writeFile: cbify(writeFile),
  stat: cbify(stat),
  lstat: cbify(stat),
  readdir: cbify(readdir),
  mkdir: cbify(mkdir),
  rmdir: cbify(rmdir),
  unlink: cbify(unlink),
  rm: cbify(rm),
  readlink: cbify(readlink),
  symlink: cbify(symlink),
};

export const capfs = { ...cbs, promises: { readFile, writeFile, stat, lstat: stat, readdir, mkdir, rmdir, unlink, rm, readlink, symlink } };
