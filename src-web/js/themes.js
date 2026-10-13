// Theme management: curated list + install via git clone (CORS-safe) with zip fallback
import { fsWriteBin, fsList, fsStat, fsExists } from './native.js';
import { unzipSync } from 'fflate';
import { cloneRepo } from './git.js';

export const CURATED_THEMES = [
  { name: 'PaperMod', repo: 'adityatelange/hugo-PaperMod', desc: '快速、简洁、功能齐全' },
  { name: 'Stack', repo: 'CaiJimmy/hugo-theme-stack', desc: '卡片式个人博客' },
  { name: 'Ananke', repo: 'theNewDynamic/gohugo-theme-ananke', desc: '经典杂志风格' },
  { name: 'Blowfish', repo: 'nunocoracao/blowfish', desc: '现代、高度可定制' },
  { name: 'LoveIt', repo: 'dillonzq/LoveIt', desc: '功能丰富、多语言' },
  { name: 'Book', repo: 'alex-shpak/hugo-book', desc: '文档 / 书籍' },
  { name: 'Terminal', repo: 'panr/hugo-theme-terminal', desc: '终端复古风' },
  { name: 'Diary', repo: 'AmazingRise/hugo-theme-diary', desc: '日记 / 随笔' },
];

export function parseRepoInput(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  const [owner, repo] = s.split('/').map((x) => x.trim());
  if (!owner || !repo) return null;
  return { owner, repo };
}

export async function ghDefaultBranch(owner, repo) {
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`GitHub API ${r.status}`);
  const j = await r.json();
  return j.default_branch;
}

export async function listInstalledThemes(site) {
  const names = (await fsList(`sites/${site}/themes`)) || [];
  const out = [];
  for (const n of names) {
    const st = await fsStat(`sites/${site}/themes/${n}`);
    if (st && st.type === 'directory') out.push(n);
  }
  return out;
}

export async function installTheme(site, repoInput, onStatus = () => {}) {
  const parsed = parseRepoInput(repoInput);
  if (!parsed) throw new Error('仓库格式应如 owner/repo');
  const { owner, repo } = parsed;
  const dest = `sites/${site}/themes/${repo}`;
  if (await fsExists(dest)) throw new Error(`主题 ${repo} 已存在`);

  let done = false;
  try {
    onStatus('尝试下载 zip…');
    done = await tryZip(dest, owner, repo, onStatus);
  } catch (e) {
    onStatus('zip 不可用：' + e.message);
  }
  if (!done) {
    onStatus('使用 git 浅克隆…');
    await cloneRepo(dest, `https://github.com/${owner}/${repo}.git`);
    onStatus('克隆完成');
  }
  return repo;
}

async function tryZip(dest, owner, repo, onStatus) {
  const br = await ghDefaultBranch(owner, repo).catch(() => null);
  const branches = br ? [br] : ['master', 'main'];
  let res = null;
  for (const b of branches) {
    try {
      const r = await fetch(`https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${b}`);
      if (r.ok) { res = r; break; }
    } catch { /* CORS or network */ }
  }
  if (!res) return false;
  const buf = new Uint8Array(await res.arrayBuffer());
  onStatus('解压中…');
  const files = unzipSync(buf);
  const keys = Object.keys(files);
  if (!keys.length) return false;
  const prefix = keys[0].split('/')[0];
  let n = 0;
  for (const [name, data] of Object.entries(files)) {
    if (!name.startsWith(prefix + '/')) continue;
    const rel = name.slice(prefix.length + 1);
    if (!rel || rel.endsWith('/')) continue;
    await fsWriteBin(`${dest}/${rel}`, data);
    n++;
  }
  onStatus(`写入 ${n} 个文件`);
  return n > 0;
}
