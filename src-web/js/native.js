// Capacitor bridge: native plugin + filesystem helpers (Directory.Data = app files dir)
import { registerPlugin, Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { b64ToU8, u8ToB64 } from './util.js';

export { Preferences };

export const isNative = () => Capacitor.isNativePlatform();

const HugoNativeWeb = {
  async info() { return { filesDir: '', cacheDir: '', hugoBin: '', nativeLibraryDir: '', mock: true }; },
  async run() { throw new Error('Hugo 构建仅支持 Android App 内运行'); },
  async startServer() { throw new Error('站点预览仅支持 Android App 内运行'); },
  async stopServer() { return {}; },
};
export const HugoNative = registerPlugin('HugoNative', { web: () => HugoNativeWeb });

// Resolve the encoding constant name from the plugin at runtime
// (avoid guessing the literal value of Encoding.UTF8 across versions)
let ENC_T = 'utf8';
export async function initEncodings() {
  try {
    const m = await import('@capacitor/filesystem');
    if (m.Encoding && m.Encoding.UTF8) ENC_T = m.Encoding.UTF8;
  } catch { /* keep fallback */ }
}

let infoCache = null;
export async function getInfo() {
  if (!infoCache) {
    try { infoCache = await HugoNative.info(); }
    catch { infoCache = { filesDir: '', cacheDir: '', hugoBin: '', nativeLibraryDir: '' }; }
  }
  return infoCache;
}

const D = Directory.Data;

export async function fsReadText(path) {
  try { const r = await Filesystem.readFile({ path, directory: D, encoding: ENC_T }); return r.data; }
  catch { return null; }
}
export async function fsReadBin(path) {
  try { const r = await Filesystem.readFile({ path, directory: D, encoding: 'base64' }); return b64ToU8(r.data); }
  catch { return null; }
}
export async function fsWriteText(path, text) {
  await Filesystem.writeFile({ path, directory: D, data: String(text), encoding: ENC_T, recursive: true });
}
export async function fsWriteBin(path, u8) {
  await Filesystem.writeFile({ path, directory: D, data: u8ToB64(u8), encoding: 'base64', recursive: true });
}
export async function fsMkdir(path) {
  await Filesystem.mkdir({ path, directory: D, recursive: true });
}
export async function fsList(path) {
  try { const r = await Filesystem.readdir({ path, directory: D }); return r.files || []; }
  catch { return null; }
}
export async function fsStat(path) {
  try { const r = await Filesystem.stat({ path, directory: D }); return r; }
  catch { return null; }
}
export async function fsExists(path) {
  const s = await fsStat(path);
  return !!s;
}
export async function fsUnlink(path) { // file or empty dir
  try { await Filesystem.deleteFile({ path, directory: D }); return true; }
  catch {
    try { await Filesystem.rmdir({ path, directory: D, recursive: true }); return true; }
    catch { return false; }
  }
}
export async function fsRmdir(path) {
  await Filesystem.rmdir({ path, directory: D, recursive: true });
}

export const sitePath = (site, rel = '') => `sites/${site}${rel ? '/' + rel.replace(/^\/+/, '') : ''}`;
export async function absSite(site) {
  const info = await getInfo();
  return `${info.filesDir}/sites/${site}`;
}
