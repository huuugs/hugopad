// HugoPad entry: router + all screens
import { h, toast, esc, slugify, modal, fmtDate } from './util.js';
import {
  isNative, Preferences, HugoNative, getInfo, initEncodings,
  fsReadText, fsWriteText, fsMkdir, fsList, fsStat, fsExists, fsRmdir, fsUnlink, sitePath, absSite,
} from './native.js';
import {
  parseDoc, buildDoc, smartTags, mergeTags, guessTitle,
  defaultConfigToml, archetypeMd, gitignoreText, welcomePost, builtinLayouts,
  CONFIG_FILES, applyThemeToConfigText,
} from './hugo.js';
import * as gitw from './git.js';
import { CURATED_THEMES, installTheme, listInstalledThemes, ghDefaultBranch } from './themes.js';
import { createEditor, setDoc, getDoc, wrapSel, prefixSel, insertAtCursor } from './editor.js';
import { marked } from 'marked';

// ---------------- settings ----------------
const S = {
  ghUser: '', ghToken: '',
  authorName: 'HugoPad', authorEmail: 'hugopad@users.noreply.github.com',
  autoTags: true, autoLastmod: true, hugoArgs: '', fontSize: 15,
};
const GKEYS = Object.keys(S);

async function loadSettings() {
  const { value } = await Preferences.get({ key: 'hp.settings' });
  if (value) { try { Object.assign(S, JSON.parse(value)); } catch { /* ignore */ } }
}
async function saveSettings() {
  await Preferences.set({ key: 'hp.settings', value: JSON.stringify(S) });
}
async function siteCfg(site) {
  const { value } = await Preferences.get({ key: `hp.site.${site}` });
  let cfg = { remote: '', branch: 'main' };
  if (value) { try { cfg = { ...cfg, ...JSON.parse(value) }; } catch { /* ignore */ } }
  return cfg;
}
async function saveSiteCfg(site, cfg) {
  await Preferences.set({ key: `hp.site.${site}`, value: JSON.stringify(cfg) });
}

// ---------------- state ----------------
const state = {
  site: null, tab: 'content',
  file: null, view: null, dirty: false, formDirty: false,
  treeOpen: false, previewRunning: false,
};

const TEXT_EXTS = ['md', 'markdown', 'toml', 'yaml', 'yml', 'json', 'txt', 'html', 'htm', 'css', 'js', 'mjs', 'xml', 'svg', 'csv', 'gitignore', 'gitmodules', 'license', 'conf'];
function isTextFile(name) {
  const base = name.split('/').pop();
  if (base.startsWith('.git')) return base === '.gitignore' || base === '.gitmodules';
  const ext = base.includes('.') ? base.split('.').pop().toLowerCase() : '';
  return !ext || TEXT_EXTS.includes(ext);
}

async function walkFiles(base, rel = '', out = [], depth = 0) {
  if (depth > 8 || out.length > 600) return out;
  const names = (await fsList(rel ? `${base}/${rel}` : base)) || [];
  for (const n of names) {
    if (n === '.git' || n === 'node_modules' || n === 'public' || n === 'resources') continue;
    const r = rel ? `${rel}/${n}` : n;
    const st = await fsStat(`${base}/${r}`);
    if (!st) continue;
    if (st.type === 'directory') await walkFiles(base, r, out, depth + 1);
    else out.push(r);
  }
  return out;
}

async function readSiteConfig(site) {
  for (const name of CONFIG_FILES) {
    const text = await fsReadText(sitePath(site, name));
    if (text != null) return { name, text };
  }
  return null;
}
async function siteTitle(site) {
  const cfg = await readSiteConfig(site);
  if (!cfg) return '';
  const m = /^title\s*[=:]\s*['"]?(.+?)['"]?\s*$/m.exec(cfg.text);
  return m ? m[1] : '';
}
async function currentThemeOf(site) {
  const cfg = await readSiteConfig(site);
  if (!cfg) return '';
  const m = /^theme\s*[=:]\s*['"]?([A-Za-z0-9_.-]+)['"]?\s*$/m.exec(cfg.text);
  return m ? m[1] : '';
}

// ---------------- router ----------------
function parseRoute() {
  const hs = (location.hash || '#/sites').slice(1);
  const m = /^\/site\/([^/]+)\/?(\w+)?/.exec(hs);
  if (m) return { name: 'site', site: decodeURIComponent(m[1]), tab: m[2] || 'content' };
  if (hs === '/settings') return { name: 'settings' };
  return { name: 'sites' };
}

async function render() {
  maybeStopPreview();
  const main = document.getElementById('main');
  main.innerHTML = '';
  try {
    const route = parseRoute();
    if (route.name === 'sites') return await renderSites(main);
    if (route.name === 'settings') return await renderSettings(main);
    if (route.name === 'site') return await renderSite(main, route);
  } catch (err) {
    console.error(err);
    main.append(h('div', { class: 'error' }, '加载失败: ' + (err?.message || err)));
  }
}

// ---------------- sites screen ----------------
async function renderSites(main) {
  const page = h('div', { class: 'page' });
  page.append(h('h2', {}, '我的站点'));
  if (!isNative()) {
    page.append(h('div', { class: 'banner' },
      '当前在浏览器预览模式：站点文件存于浏览器存储；Hugo 构建、站点预览、Git 推送需在 Android App 内使用。'));
  }
  const names = (await fsList('sites').catch(() => null)) || [];
  const dirs = [];
  for (const n of names) {
    const st = await fsStat(`sites/${n}`);
    if (st && st.type === 'directory') dirs.push(n);
  }
  for (const name of dirs) {
    const title = await siteTitle(name);
    page.append(h('div', { class: 'card site-card' },
      h('div', null,
        h('b', {}, name),
        h('div', { class: 'muted' }, title || '（未命名站点）')),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => { location.hash = `/site/${encodeURIComponent(name)}/content`; } }, '打开'),
        h('button', { class: 'danger', onclick: async () => {
          if (!confirm(`删除站点「${name}」及其全部内容？不可恢复！`)) return;
          await fsRmdir(`sites/${name}`);
          toast('已删除');
          render();
        } }, '删除'),
      )));
  }
  if (!dirs.length) page.append(h('p', { class: 'muted' }, '还没有站点，先创建一个吧。'));
  page.append(h('div', { style: 'margin:14px 0' },
    h('button', { class: 'primary big', onclick: newSiteModal }, '＋ 新建站点')));
  page.append(h('div', { class: 'row gap' },
    h('a', { href: '#/settings' }, '⚙ 设置与帮助'),
    h('span', { class: 'muted' }, '· 推送前请先在设置中配置 GitHub 账号'),
  ));
  main.append(page);
}

function newSiteModal() {
  modal({
    title: '新建 Hugo 站点',
    fields: [
      { key: 'name', label: '站点目录名（字母/数字/-）', required: true, placeholder: 'my-blog' },
      { key: 'title', label: '站点标题', placeholder: '我的博客' },
    ],
    onOk: async (v) => {
      const name = v.name.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) throw new Error('目录名仅限字母、数字、-、_');
      if (await fsExists(`sites/${name}`)) throw new Error(`站点 ${name} 已存在`);
      await scaffoldSite(name, v.title.trim() || name);
      toast('站点已创建');
      location.hash = `/site/${encodeURIComponent(name)}/content`;
    },
  });
}

async function scaffoldSite(name, title) {
  for (const d of ['', '/archetypes', '/assets', '/content/posts', '/data', '/i18n', '/layouts', '/static', '/themes']) {
    await fsMkdir(sitePath(name, d));
  }
  await fsWriteText(sitePath(name, 'hugo.toml'), defaultConfigToml(title));
  await fsWriteText(sitePath(name, 'archetypes/default.md'), archetypeMd());
  await fsWriteText(sitePath(name, '.gitignore'), gitignoreText());
  await fsWriteText(sitePath(name, 'content/posts/hello-hugopad.md'), welcomePost());
  for (const [rel, content] of Object.entries(builtinLayouts())) {
    await fsWriteText(sitePath(name, rel), content);
  }
}

// ---------------- site shell ----------------
async function renderSite(main, route) {
  state.site = route.site;
  state.tab = route.tab;
  if (!(await fsExists(`sites/${route.site}`))) { location.hash = '#/sites'; return; }

  const tabs = [['content', '📝 内容'], ['themes', '🎨 主题'], ['build', '🔨 构建/预览'], ['git', '☁ Git / 部署']];
  const page = h('div', { class: 'page' });
  page.append(h('div', { class: 'site-head' },
    h('a', { href: '#/sites' }, '‹ 站点'),
    h('b', {}, route.site),
    h('span', { class: 'muted' }, (await siteTitle(route.site)) || '')));
  page.append(h('div', { class: 'tabs' }, tabs.map(([k, label]) =>
    h('button', { class: 'tab' + (k === state.tab ? ' active' : ''), onclick: () => {
      if (state.dirty && !confirm('当前文件未保存，离开将丢失修改。继续？')) return;
      location.hash = `/site/${encodeURIComponent(route.site)}/${k}`;
    } }, label))));
  const body = h('div', { class: 'tab-body' });
  page.append(body);
  main.append(page);

  if (state.tab === 'content') await renderContentTab(body, route.site);
  else if (state.tab === 'themes') await renderThemesTab(body, route.site);
  else if (state.tab === 'build') await renderBuildTab(body, route.site);
  else await renderGitTab(body, route.site);
}

// ---------------- content tab ----------------
async function renderContentTab(body, site) {
  state.file = state.file && (await fsExists(sitePath(site, state.file))) ? state.file : null;
  state.dirty = false; state.formDirty = false;

  const saveBtn = h('button', { class: 'primary', onclick: saveCurrentFile }, '💾 保存');
  const treeBtn = h('button', { onclick: () => { state.treeOpen ? closeTree() : openTree(); } }, '📂 文件');
  const toolbar = h('div', { class: 'toolbar' },
    treeBtn,
    h('button', { onclick: () => newPostModal(site) }, '＋ 新文章'),
    saveBtn,
    h('button', { onclick: () => smartTagsModal(site) }, '🏷 标签'),
    h('button', { onclick: () => mdPreviewOverlay() }, '👁 预览'),
  );
  const chips = h('div', { class: 'chips' },
    ...[['H1', () => prefixSel(state.view, '# ')], ['H2', () => prefixSel(state.view, '## ')], ['H3', () => prefixSel(state.view, '### ')],
      ['B', () => wrapSel(state.view, '**')], ['I', () => wrapSel(state.view, '*')], ['`', () => wrapSel(state.view, '`')],
      ['链接', () => insertAtCursor(state.view, '[]()')], ['图片', () => insertAtCursor(state.view, '![]()')],
      ['列表', () => prefixSel(state.view, '- ')], ['任务', () => prefixSel(state.view, '- [ ] ')],
      ['引用', () => prefixSel(state.view, '> ')], ['代码块', () => wrapSel(state.view, '```\n', '\n```')],
      ['表格', () => insertAtCursor(state.view, '\n| 列1 | 列2 |\n| --- | --- |\n|  |  |\n')],
      ['分隔', () => insertAtCursor(state.view, '\n---\n')],
    ].map(([label, fn]) => h('button', { onclick: () => state.view && fn() }, label)));

  const metaBox = h('details', { class: 'meta' });
  buildMetaForm(metaBox);

  const editorBox = h('div', { class: 'editor' });
  state.view = createEditor(editorBox, {
    fontSize: S.fontSize,
    onDirty: () => { state.dirty = true; saveBtn.textContent = '💾 保存 *'; },
  });

  const treeHost = h('div');
  body.append(toolbar, chips, metaBox, editorBox, treeHost);

  async function openTree() {
    state.treeOpen = true;
    treeHost.innerHTML = '';
    const aside = h('aside', { class: 'tree' },
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('b', {}, '站点文件'),
        h('button', { onclick: closeTree }, '✕')),
      await buildTree(site, '', 0));
    treeHost.append(aside);
  }
  function closeTree() { state.treeOpen = false; treeHost.innerHTML = ''; }

  if (state.file) {
    await openFileInternal(site, state.file, saveBtn, metaBox);
  } else {
    setDoc(state.view, '<!-- 选择左侧「📂 文件」打开或新建文章 -->\n');
  }

  async function openFileInternal(site2, rel, saveBtn2, metaBox2) {
    const text = await fsReadText(sitePath(site2, rel));
    if (text == null) { toast('读取失败: ' + rel); return; }
    state.file = rel;
    setDoc(state.view, text);
    state.dirty = false; state.formDirty = false;
    saveBtn2.textContent = '💾 保存';
    syncMetaForm(metaBox2);
    document.getElementById('topbar-right').textContent = rel;
  }

  async function openFile(rel) {
    if (state.dirty && !confirm('当前文件未保存，切换将丢失修改。继续？')) return;
    await openFileInternal(site, rel, saveBtn, metaBox);
    closeTree();
  }

  async function buildTree(site2, rel, depth) {
    const base = sitePath(site2, rel);
    let names;
    if (!rel) {
      const all = (await fsList(base)) || [];
      names = all.filter((n) => TOP_DIRS.includes(n) || CONFIG_FILES.includes(n) || n === 'README.md' || n === '.gitignore');
      names.sort((a, b) => TOP_DIRS.indexOf(a) - TOP_DIRS.indexOf(b));
    } else {
      names = ((await fsList(base)) || []).sort();
    }
    const ul = h('div');
    for (const n of names) {
      const r = rel ? `${rel}/${n}` : n;
      const st = await fsStat(sitePath(site2, r));
      if (!st) continue;
      const isDir = st.type === 'directory';
      const item = h('div', { class: 'tree-item' + (state.file === r ? ' active' : ''), onclick: isDir ? null : () => openFile(r) },
        h('span', { class: 'tw' }, isDir ? '▸' : '·'),
        h('span', {}, (isDir ? '📁 ' : '') + n));
      ul.append(item);
      if (isDir && depth < 3) {
        const child = h('div', { class: 'dir', style: 'display:none;margin-left:12px' });
        item.addEventListener('click', async () => {
          if (child.style.display === 'none') {
            if (!child.childElementCount) child.append(await buildTree(site2, r, depth + 1));
            child.style.display = 'block';
            item.querySelector('.tw').textContent = '▾';
          } else {
            child.style.display = 'none';
            item.querySelector('.tw').textContent = '▸';
          }
        });
        ul.append(child);
      }
    }
    return ul;
  }

  function buildMetaForm(box) {
    box.innerHTML = '';
    box.append(h('summary', {}, '⚙ 元信息（Front Matter）'));
    const grid = h('div', { class: 'meta-grid' },
      field('title', '标题', 'text'), field('slug', 'Slug', 'text'), field('draft', '草稿', 'checkbox'),
      field('date', '日期', 'text'), field('tags', '标签（逗号分隔）', 'text'), field('categories', '分类（逗号分隔）', 'text'),
      field('summary', '摘要', 'textarea', true));
    grid.addEventListener('input', () => { state.formDirty = true; });
    box.append(grid);
    function field(key, label, type, full = false) {
      const lab = h('label', { class: 'field' + (full ? ' full' : '') });
      lab.append(h('span', {}, label));
      let input;
      if (type === 'checkbox') {
        input = h('input', { type: 'checkbox', 'data-fm': key });
        lab.innerHTML = '';
        lab.append(input, ' ', h('span', { style: 'font-size:13px;color:var(--muted)' }, label));
      } else if (type === 'textarea') {
        input = h('textarea', { rows: 2, 'data-fm': key });
        lab.append(input);
      } else {
        input = h('input', { type, 'data-fm': key });
        lab.append(input);
      }
      return lab;
    }
  }

  function syncMetaForm(box) {
    const doc = parseDoc(getDoc(state.view));
    const set = (k, v) => {
      const el = box.querySelector(`[data-fm="${k}"]`);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = v === true || v === 'true';
      else if (k === 'tags' || k === 'categories') el.value = Array.isArray(v) ? v.join(', ') : (v || '');
      else el.value = v == null ? '' : v;
    };
    for (const k of ['title', 'slug', 'draft', 'date', 'tags', 'categories', 'summary']) set(k, doc.fm[k]);
  }

  async function collectMeta() {
    const doc = parseDoc(getDoc(state.view));
    const meta = { formDirty: state.formDirty };
    const val = (k) => metaBox.querySelector(`[data-fm="${k}"]`);
    meta.title = val('title')?.value.trim();
    meta.slug = val('slug')?.value.trim();
    meta.draft = val('draft')?.checked;
    meta.tags = splitList(val('tags')?.value);
    meta.categories = splitList(val('categories')?.value);
    meta.summary = val('summary')?.value.trim();
    return meta;
  }

  async function saveCurrentFile() {
    if (!state.file || !state.view) { toast('没有打开的文件'); return; }
    const text = getDoc(state.view);
    let doc = parseDoc(text);
    const meta = await collectMeta();

    const fm = { ...doc.fm };
    const fallbackTitle = guessTitle(doc.body, state.file) || '无标题';
    fm.title = meta.formDirty && meta.title ? meta.title : (fm.title || fallbackTitle);
    if (!fm.date) fm.date = fmtDate();
    if (S.autoLastmod) fm.lastmod = fmtDate();
    if (meta.formDirty) {
      if (meta.slug) fm.slug = meta.slug;
      if (meta.summary) fm.summary = meta.summary;
      if (meta.categories.length) fm.categories = meta.categories;
      fm.draft = meta.draft;
      if (meta.tags.length) fm.tags = meta.tags;
    }
    let autoAdded = [];
    if (S.autoTags && (!fm.tags || !fm.tags.length)) {
      const existing = await collectSiteTags(site);
      autoAdded = smartTags(doc.body, existing).slice(0, 3);
      if (autoAdded.length) fm.tags = autoAdded;
    }
    const type = doc.type || 'yaml';
    const out = buildDoc(type, fm, doc.body);
    await fsWriteText(sitePath(site, state.file), out);
    if (out !== text) setDoc(state.view, out);
    state.dirty = false; state.formDirty = false;
    saveBtn.textContent = '💾 保存';
    syncMetaForm(metaBox);
    toast(autoAdded.length ? `已保存（自动添加标签：${autoAdded.join('、')}）` : '已保存 ✓');
  }

  function newPostModal(site2) {
    modal({
      title: '新建文章',
      fields: [
        { key: 'title', label: '标题（必填）', required: true, placeholder: '我的第一篇文章' },
        { key: 'section', label: '目录（content/ 下）', value: 'posts' },
        { key: 'slug', label: '文件名（留空自动生成）', placeholder: 'my-first-post' },
        { key: 'tags', label: '标签（逗号分隔，可留空自动推荐）', placeholder: '随笔, 生活' },
        { key: 'draft', label: '草稿', type: 'checkbox', checked: false },
      ],
      onOk: async (v) => {
        const title = v.title.trim();
        if (!title) throw new Error('请输入标题');
        const section = (v.section.trim() || 'posts').replace(/^\/+|\/+$/g, '');
        const slug = slugify(v.slug || title) || slugify(title) || ('p-' + Date.now());
        const rel = `content/${section}/${slug}.md`;
        if (await fsExists(sitePath(site2, rel))) throw new Error(`文件已存在：${rel}`);
        const fm = {
          title, date: fmtDate(), lastmod: fmtDate(), draft: v.draft,
          tags: splitList(v.tags), categories: [],
        };
        if (S.autoTags && !fm.tags.length) {
          const existing = await collectSiteTags(site2);
          fm.tags = smartTags(title, existing).slice(0, 3);
        }
        await fsWriteText(sitePath(site2, rel), buildDoc('yaml', fm, '\n'));
        state.file = rel;
        toast('已创建 ' + rel);
        location.hash = location.hash; // no-op
        render();
      },
    });
  }

  async function smartTagsModal(site2) {
    if (!state.file || !state.view) { toast('请先打开一篇文章'); return; }
    const doc = parseDoc(getDoc(state.view));
    const existing = await collectSiteTags(site2);
    const sugg = smartTags(doc.body, existing);
    const cur = Array.isArray(doc.fm.tags) ? doc.fm.tags : [];
    const all = [...new Set([...cur, ...sugg])].slice(0, 12);
    if (!all.length) { toast('暂无推荐标签，多写点内容再试试'); return; }
    modal({
      title: '推荐标签（保存文章时也会自动补充）',
      html: `<div class="tagcheck" id="tagcheck">${all.map((t) =>
        `<label><input type="checkbox" value="${esc(t)}" ${cur.includes(t) || sugg.slice(0, 3).includes(t) ? 'checked' : ''} hidden>${esc(t)}</label>`).join('')}</div>`,
      okText: '应用',
      onOk: (_, close) => {
        const picked = [...document.querySelectorAll('#tagcheck input:checked')].map((i) => i.value);
        if (!picked.length) { close(); return; }
        const fm = { ...doc.fm, tags: mergeTags(doc.fm.tags, picked) };
        setDoc(state.view, buildDoc(doc.type || 'yaml', fm, doc.body));
        state.dirty = true;
        syncMetaForm(metaBox);
        close();
        toast('标签已写入，记得保存');
      },
    });
  }

  async function collectSiteTags(site2) {
    const files = (await walkFiles(sitePath(site2, 'content'))).filter((f) => /\.md$/i.test(f)).slice(0, 150);
    const tags = [];
    for (const f of files) {
      const text = await fsReadText(sitePath(site2, `content/${f}`));
      if (text == null) continue;
      const doc = parseDoc(text);
      if (Array.isArray(doc.fm.tags)) tags.push(...doc.fm.tags);
    }
    return [...new Set(tags)];
  }

  function mdPreviewOverlay() {
    if (!state.view) return;
    const doc = parseDoc(getDoc(state.view));
    const html = marked.parse(doc.body || '');
    const overlay = h('div', { class: 'overlay' },
      h('button', { class: 'close primary', onclick: () => overlay.remove() }, '✕ 关闭'),
      h('h2', {}, esc(doc.fm.title || state.file || '预览')),
      h('div', { class: 'md-body', html }));
    document.body.append(overlay);
  }
}

function splitList(s) {
  return String(s || '').split(/[,，、]/).map((x) => x.trim()).filter(Boolean);
}

const TOP_DIRS = ['content', 'archetypes', 'assets', 'data', 'i18n', 'layouts', 'static', 'themes'];

// ---------------- themes tab ----------------
async function renderThemesTab(body, site) {
  const cur = await currentThemeOf(site);
  const installed = await listInstalledThemes(site);

  const wrap = h('div');
  wrap.append(h('div', { class: 'card' },
    h('b', {}, '当前主题：'), ' ', h('span', { class: 'pill' + (cur ? ' ok' : ' err') }, cur || '未设置'),
    h('div', { class: 'status-line' }, '已安装 ' + installed.length + ' 个主题（位于 themes/ 目录）')));

  // installed list
  const list = h('div', { class: 'card' });
  list.append(h('b', {}, '已安装'));
  if (!installed.length) list.append(h('p', { class: 'muted' }, '暂无，从下面推荐列表安装一个吧。'));
  for (const t of installed) {
    list.append(h('div', { class: 'row', style: 'justify-content:space-between;margin:6px 0' },
      h('span', {}, (cur === t ? '✅ ' : '') + t),
      h('span', { class: 'row' },
        h('button', { onclick: () => applyTheme(site, t) }, '设为当前'),
        h('button', { class: 'danger', onclick: async () => {
          if (!confirm(`删除主题 ${t}？`)) return;
          await fsRmdir(sitePath(site, `themes/${t}`));
          toast('已删除'); render();
        } }, '删除'))));
  }
  wrap.append(list);

  // custom install
  wrap.append(h('div', { class: 'card' },
    h('b', {}, '从 GitHub 安装'),
    h('label', { class: 'field' },
      h('span', {}, '仓库（owner/repo 或完整 URL）'),
      h('input', { id: 'theme-repo', placeholder: 'adityatelange/hugo-PaperMod' })),
    h('button', { class: 'primary', onclick: async (e) => {
      const input = document.getElementById('theme-repo');
      await doInstall(site, input.value, e.target);
    } }, '⬇ 安装')));

  // curated grid
  const grid = h('div', { class: 'theme-grid', style: 'margin-top:10px' });
  for (const t of CURATED_THEMES) {
    grid.append(h('div', { class: 'card' },
      h('b', {}, t.name),
      h('div', { class: 'muted' }, t.desc),
      h('div', { class: 'muted', style: 'font-size:12px' }, t.repo),
      h('div', { class: 'row', style: 'margin-top:6px' },
        h('button', { onclick: async (e) => await doInstall(site, t.repo, e.target) }, installed.includes(t.repo) ? '重装' : '⬇ 安装'),
        h('a', { href: `https://github.com/${t.repo}`, target: '_blank' }, '预览'))));
  }
  wrap.append(h('h2', {}, '推荐主题'), grid);
  wrap.append(h('p', { class: 'muted' }, '提示：内置 Hugo 优先尝试 Extended 构建（支持 SCSS 主题）；若构建失败请查看构建日志。'));
  body.append(wrap);

  async function doInstall(site2, repoInput, btn) {
    const old = btn.textContent;
    btn.disabled = true;
    try {
      const name = await installTheme(site2, repoInput, (s) => { btn.textContent = s; });
      toast(`主题 ${name} 安装完成`);
      await applyTheme(site2, name, true);
      render();
    } catch (e) {
      toast('安装失败: ' + e.message, 4000);
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }
}

async function applyTheme(site, name, silent = false) {
  const cfg = await readSiteConfig(site);
  if (!cfg) { toast('找不到配置文件（hugo.toml / config.*）'); return; }
  const next = applyThemeToConfigText(cfg.text, name);
  await fsWriteText(sitePath(site, cfg.name), next);
  if (!silent) { toast(`已启用主题 ${name}`); render(); }
}

// ---------------- build tab ----------------
async function renderBuildTab(body, site) {
  const info = await getInfo();
  const wrap = h('div');
  const verLine = h('div', { class: 'status-line' }, isNative() ? '' : '浏览器模式无法运行 Hugo');
  const log = h('pre', { class: 'log', id: 'buildlog' }, '构建输出将显示在这里…\n');
  const iframe = h('iframe', { class: 'preview', id: 'sitepreview', style: 'display:none' });
  const argsInput = h('input', { value: S.hugoArgs, placeholder: '附加参数，如 --minify --buildDrafts' });

  wrap.append(
    h('div', { class: 'card' },
      h('b', {}, 'Hugo 构建'),
      h('div', { class: 'row', style: 'margin:8px 0' },
        h('button', { onclick: async () => {
          const r = await HugoNative.run({ bin: info.hugoBin, args: ['version'] });
          verLine.textContent = r.out.split('\n')[0];
        } }, '检查版本'),
        h('button', { class: 'primary', onclick: async (e) => { await doBuild(e.target); } }, '🔨 构建'),
        h('button', { onclick: async (e) => {
          const ok = await doBuild(e.target);
          if (!ok) return;
          try {
            const r = await HugoNative.startServer({ root: `${await absSite(site)}/public` });
            iframe.style.display = 'block';
            iframe.src = r.url + '/';
            state.previewRunning = true;
            toast('预览已启动: ' + r.url);
          } catch (err) { toast('预览失败: ' + err.message, 4000); }
        } }, '▶ 构建并预览'),
        h('button', { onclick: async () => {
          await HugoNative.stopServer().catch(() => {});
          state.previewRunning = false;
          iframe.style.display = 'none';
          toast('预览已停止');
        } }, '■ 停止预览'),
        h('button', { onclick: () => { iframe.src = iframe.src; } }, '⟳ 刷新'),
      ),
      h('label', { class: 'field' }, h('span', {}, '附加构建参数（自动保存）'), argsInput),
      verLine, log),
    h('h2', {}, '站点预览'),
    iframe,
  );
  argsInput.addEventListener('change', async () => { S.hugoArgs = argsInput.value.trim(); await saveSettings(); });
  body.append(wrap);

  async function doBuild(btn) {
    if (!isNative()) { toast('浏览器模式无法运行 Hugo'); return false; }
    const old = btn?.textContent; if (btn) { btn.disabled = true; btn.textContent = '构建中…'; }
    log.textContent = '';
    try {
      const abs = await absSite(site);
      const info2 = await getInfo();
      const extra = S.hugoArgs ? S.hugoArgs.split(/\s+/).filter(Boolean) : [];
      const r = await HugoNative.run({
        bin: info2.hugoBin,
        args: ['--source', abs, '--cacheDir', `${info2.cacheDir}/hugo`, '--destination', `${abs}/public`, '--cleanDestinationDir', ...extra],
        timeoutMs: 600, // seconds
      });
      log.textContent = r.out || '(无输出)';
      if (r.code === 0) { toast('构建成功 ✓'); return true; }
      toast('构建失败，退出码 ' + r.code, 4000);
      return false;
    } catch (e) {
      log.textContent = String(e?.message || e);
      toast('构建出错: ' + e.message, 4000);
      return false;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = old; }
    }
  }
}

function maybeStopPreview() {
  if (state.previewRunning) {
    state.previewRunning = false;
    HugoNative.stopServer().catch(() => {});
  }
  document.getElementById('topbar-right').textContent = '';
}

// ---------------- git tab ----------------
async function renderGitTab(body, site) {
  const cfg = await siteCfg(site);
  const hasRepo = await fsExists(sitePath(site, '.git'));
  const branch = (await gitw.currentBranch(sitePath(site)).catch(() => null)) || cfg.branch || 'main';

  const wrap = h('div');
  wrap.append(h('div', { class: 'card' },
    h('b', {}, 'Git 仓库'),
    ' ', h('span', { class: 'pill' + (hasRepo ? ' ok' : ' err') }, hasRepo ? `已初始化（${branch}）` : '未初始化'),
    !hasRepo ? h('button', { class: 'primary', style: 'margin-left:8px', onclick: async () => {
      await gitw.gitInit(sitePath(site));
      toast('Git 仓库已初始化（main）');
      render();
    } }, '初始化仓库') : null));

  // settings form
  const f = (key, label, val, type = 'text') => h('label', { class: 'field' },
    h('span', {}, label),
    h('input', { type, value: val ?? '', dataset: { key } }));
  const form = h('div', { class: 'card' },
    h('b', {}, '推送配置（保存到本机）'),
    f('remote', '仓库地址（HTTPS，如 https://github.com/user/repo.git）', cfg.remote),
    f('branch', '分支', branch),
    h('div', { class: 'meta-grid' },
      f('ghUser', 'GitHub 用户名', S.ghUser),
      f('ghToken', 'GitHub Token（repo 权限）', S.ghToken, 'password')),
    h('div', { class: 'meta-grid' },
      f('authorName', '提交作者名', S.authorName),
      f('authorEmail', '提交邮箱', S.authorEmail)),
    h('button', { class: 'primary', onclick: async () => {
      const g = (k) => form.querySelector(`[data-key="${k}"]`).value.trim();
      cfg.remote = g('remote'); cfg.branch = g('branch') || 'main';
      await saveSiteCfg(site, cfg);
      S.ghUser = g('ghUser'); S.ghToken = g('ghToken');
      S.authorName = g('authorName') || 'HugoPad'; S.authorEmail = g('authorEmail');
      await saveSettings();
      toast('配置已保存 ✓');
    } }, '💾 保存配置'));
  wrap.append(form);

  // status + commit + push
  const statusBox = h('div', { class: 'card' });
  const commitMsg = h('input', { placeholder: '提交信息，如: 新文章《xxx》', value: '' });
  statusBox.append(h('b', {}, '变更与提交'));
  const statusList = h('ul', { class: 'filelist' });
  statusBox.append(statusList,
    h('label', { class: 'field' }, h('span', {}, '提交信息'), commitMsg),
    h('div', { class: 'row' },
      h('button', { onclick: refreshStatus }, '⟳ 刷新状态'),
      h('button', { class: 'primary', onclick: doCommit }, '⬆ 提交全部变更'),
      h('button', { class: 'primary', onclick: doPush }, '☁ 推送（触发部署）')));
  wrap.append(statusBox);

  // edgeone guide
  wrap.append(h('details', { class: 'meta' },
    h('summary', {}, '📘 如何连接腾讯 EdgeOne Pages 自动部署？'),
    h('div', { class: 'card muted', html: `
<ol>
<li>在 <a href="https://console.cloud.tencent.com/edgeone/pages" target="_blank">EdgeOne Pages 控制台</a> 创建项目，导入上面的 GitHub 仓库（建议先建<b>空仓库</b>）。</li>
<li>框架选择 <b>Hugo</b>（EdgeOne 会自动识别），输出目录 <code>public</code>，保存后即完成一次部署。</li>
<li>回到本 App：填好仓库地址 / 分支 / GitHub 用户名 + Token → 保存。</li>
<li>每次写完文章 → 「提交全部变更」→「推送」，EdgeOne 检测到 push 后自动构建发布 🎉</li>
</ol>
<p>Token 获取：GitHub → Settings → Developer settings → Personal access tokens，勾选 <code>repo</code> 权限。Token 仅保存在手机应用私有目录。</p>` })));
  body.append(wrap);
  await refreshStatus();

  async function refreshStatus() {
    statusList.innerHTML = '';
    try {
      const rows = await gitw.statusRows(sitePath(site));
      let n = 0;
      for (const [file, head, workdir] of rows) {
        if (head === workdir && workdir !== 0) continue;
        const label = head === 0 && workdir !== 0 ? '新增' : workdir === 0 ? '删除' : '修改';
        statusList.append(h('li', null, `[${label}] ${file}`));
        n++;
      }
      if (!n) statusList.append(h('li', { class: 'muted' }, '没有未提交的变更'));
    } catch (e) {
      statusList.append(h('li', { class: 'muted' }, '尚未初始化 Git 仓库'));
    }
  }

  async function doCommit() {
    if (!(await fsExists(sitePath(site, '.git')))) { toast('请先初始化 Git 仓库'); return; }
    const msg = commitMsg.value.trim() || ('更新 ' + new Date().toLocaleString('zh-CN'));
    toast('提交中…');
    try {
      const { staged, sha } = await gitw.commitAll(sitePath(site), msg, {
        name: S.authorName || 'HugoPad',
        email: S.authorEmail || 'hugopad@users.noreply.github.com',
      });
      if (!staged) { toast('没有需要提交的变更'); }
      else { toast(`已提交 ${staged} 个文件 (${(sha || '').slice(0, 7)})`); commitMsg.value = ''; }
      await refreshStatus();
    } catch (e) { toast('提交失败: ' + e.message, 5000); }
  }

  async function doPush() {
    if (!(await fsExists(sitePath(site, '.git')))) { toast('请先初始化 Git 仓库'); return; }
    const cfg2 = await siteCfg(site);
    if (!cfg2.remote) { toast('请先填写并保存仓库地址'); return; }
    if (!S.ghToken) { toast('请先在设置中填写 GitHub Token'); return; }
    const br = (await gitw.currentBranch(sitePath(site)).catch(() => null)) || cfg2.branch || 'main';
    toast('推送中…（可能需要几十秒）', 8000);
    try {
      await gitw.setRemote(sitePath(site), cfg2.remote);
      await gitw.pushTo(sitePath(site), {
        url: cfg2.remote, ref: br, username: S.ghUser || 'oauth2', password: S.ghToken,
      });
      toast('推送成功 ✓ EdgeOne 将自动构建（若已连接）', 5000);
    } catch (e) {
      const m = String(e?.message || e);
      let hint = m;
      if (/fetch first|non-fast-forward/i.test(m)) hint = '远端仓库不为空且与本仓库无共同历史。建议在 GitHub 建空仓库，或在电脑上 pull/merge 后再推。';
      else if (/auth|401|403/i.test(m)) hint = '认证失败：检查用户名 / Token（需 repo 权限）。';
      else if (/Could not resolve|network/i.test(m)) hint = '网络错误：稍后重试。';
      toast('推送失败: ' + hint, 7000);
    }
  }
}

// ---------------- settings screen ----------------
async function renderSettings(main) {
  const page = h('div', { class: 'page' });
  page.append(h('h2', {}, '⚙ 设置'));

  const f = (key, label, val, type = 'text') => h('label', { class: 'field' },
    h('span', {}, label), h('input', { type, value: val ?? '', dataset: { key } }));

  const box = h('div', { class: 'card' },
    h('b', {}, '通用'),
    f('fontSize', '编辑器字号（12-24）', S.fontSize),
    h('label', { class: 'field' }, h('span', {}, 'Hugo 附加构建参数'), h('input', { dataset: { key: 'hugoArgs' }, value: S.hugoArgs, placeholder: '--minify --buildDrafts' })),
    h('div', { class: 'meta-grid' },
      h('label', { class: 'field' }, h('input', { type: 'checkbox', dataset: { key: 'autoTags' }, checked: S.autoTags }), ' 保存时自动推荐/补充标签'),
      h('label', { class: 'field' }, h('input', { type: 'checkbox', dataset: { key: 'autoLastmod' }, checked: S.autoLastmod }), ' 保存时自动更新 lastmod')),
    h('div', { class: 'meta-grid' },
      f('ghUser', 'GitHub 用户名', S.ghUser),
      f('ghToken', 'GitHub Token（repo）', S.ghToken, 'password')),
    h('div', { class: 'meta-grid' },
      f('authorName', 'Git 作者名', S.authorName),
      f('authorEmail', 'Git 邮箱', S.authorEmail)),
    h('button', { class: 'primary', onclick: async () => {
      const g = (k) => page.querySelector(`[data-key="${k}"]`);
      S.fontSize = Math.min(24, Math.max(12, Number(g('fontSize').value) || 15));
      S.hugoArgs = g('hugoArgs').value.trim();
      S.autoTags = g('autoTags').checked;
      S.autoLastmod = g('autoLastmod').checked;
      S.ghUser = g('ghUser').value.trim();
      S.ghToken = g('ghToken').value.trim();
      S.authorName = g('authorName').value.trim() || 'HugoPad';
      S.authorEmail = g('authorEmail').value.trim();
      await saveSettings();
      toast('已保存 ✓');
    } }, '💾 保存设置'));
  page.append(box);

  page.append(h('div', { class: 'card muted', html: `
<b style="color:var(--fg)">使用流程</b>
<ol>
<li>新建站点 → 「主题」页安装主题 → 「内容」页写文章（自动 front matter / 标签）</li>
<li>「构建/预览」页一键构建并本地预览整站</li>
<li>「Git / 部署」页配置仓库 + Token → 提交 → 推送 → EdgeOne Pages 自动发布</li>
</ol>
<p>安全提示：Token 保存在应用私有目录，不会上传；如泄露请到 GitHub 撤销。</p>` }));
  page.append(h('div', { class: 'row gap' }, h('a', { href: '#/sites' }, '‹ 返回站点列表')));
  main.append(page);
}

// ---------------- boot ----------------
window.addEventListener('hashchange', render);
window.addEventListener('unhandledrejection', (e) => {
  const msg = e?.reason?.message || String(e?.reason || '');
  if (msg && !/aborted/i.test(msg)) toast('错误: ' + msg, 4000);
});

(async function main() {
  await initEncodings();
  await loadSettings();
  await render();
})();
