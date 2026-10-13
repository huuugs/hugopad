// Hugo front matter: parse / serialize / auto tags / site scaffold templates.
// Pure functions — no DOM, no Capacitor (testable in Node).

export const FM_ORDER = ['title', 'date', 'lastmod', 'draft', 'weight', 'slug', 'description', 'summary', 'images', 'tags', 'categories'];

// ---------- parse ----------
export function parseDoc(text) {
  const mT = /^\+\+\+\r?\n([\s\S]*?)\r?\n\+\+\+\r?\n?/.exec(text);
  if (mT) return { type: 'toml', fm: parseKV(mT[1], 'toml'), raw: mT[1], body: text.slice(mT[0].length) };
  const mY = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (mY) return { type: 'yaml', fm: parseKV(mY[1], 'yaml'), raw: mY[1], body: text.slice(mY[0].length) };
  return { type: null, fm: {}, raw: '', body: text };
}

function parseScalar(s) {
  s = s.trim();
  if (!s) return '';
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}

function parseArray(s) {
  const inner = s.trim().replace(/^\[/, '').replace(/\]$/, '').trim();
  if (!inner) return [];
  const parts = inner.match(/"[^"]*"|'[^']*'|[^,]+/g) || [];
  return parts.map((p) => parseScalar(p)).filter((p) => p !== '' && p != null);
}

function parseKV(raw, kind) {
  const fm = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = kind === 'toml'
      ? /^([A-Za-z_][\w-]*)\s*=\s*(.+)$/.exec(line.trim())
      : /^([A-Za-z_][\w-]*)\s*:\s*(.+)$/.exec(line.trim());
    if (!m) continue;
    const key = m[1], val = m[2].trim();
    if (/^\[.*\]$/.test(val)) fm[key] = parseArray(val);
    else fm[key] = parseScalar(val);
  }
  return fm;
}

// ---------- serialize ----------
function yamlStr(v) {
  if (v === true || v === false || v == null) return String(v);
  const s = String(v);
  if (/^[-?:,\[\]{}#&*!|>'"%@`]/.test(s) || /[:#]/.test(s) || /\s/.test(s) || /[\u4e00-\u9fff]/.test(s) === false && /^$/.test(s)) {
    return JSON.stringify(s);
  }
  if (/^[\u4e00-\u9fff]/.test(s)) return JSON.stringify(s); // keep CJK quoted for safety
  return s;
}
function tomlStr(v) { return JSON.stringify(String(v)); }

function serializeFM(type, fm) {
  const lines = [];
  const seen = new Set();
  const put = (k, v) => {
    seen.add(k);
    if (type === 'toml') {
      if (v === true || v === false) lines.push(`${k} = ${v}`);
      else if (Array.isArray(v)) lines.push(`${k} = [${v.map(tomlStr).join(', ')}]`);
      else if (typeof v === 'number') lines.push(`${k} = ${v}`);
      else lines.push(`${k} = ${tomlStr(v)}`);
    } else {
      if (v === true || v === false) lines.push(`${k}: ${v}`);
      else if (Array.isArray(v)) lines.push(`${k}: [${v.map(yamlStr).join(', ')}]`);
      else if (typeof v === 'number') lines.push(`${k}: ${v}`);
      else lines.push(`${k}: ${yamlStr(v)}`);
    }
  };
  for (const k of FM_ORDER) if (fm[k] !== undefined && fm[k] !== null) put(k, fm[k]);
  for (const [k, v] of Object.entries(fm)) {
    if (seen.has(k) || k.startsWith('_')) continue;
    put(k, v);
  }
  return lines.join('\n');
}

export function buildDoc(type, fm, body) {
  const t = type === 'toml' ? '+++' : '---';
  const head = `${t}\n${serializeFM(type, fm)}\n${t}\n`;
  const b = String(body || '');
  return head + (b.startsWith('\n') || b === '' ? b : '\n' + b);
}

// ---------- auto tags ----------
const EN_STOP = new Set(('the a an and or but if then else for to of in on at by with from as is are was were be been being ' +
  'this that these those it its you your we our they their he she his her not no do does did can could should would will ' +
  'just about into over under more most other some such only own same so than too very what when where which who how why').split(' '));
const CN_STOP = new Set(['我们', '你们', '他们', '自己', '什么', '这个', '那个', '这样', '那样', '可以', '因为', '所以',
  '但是', '而且', '然后', '或者', '还是', '已经', '没有', '不会', '就是', '一个', '一些', '如果', '对于', '以及',
  '通过', '使用', '进行', '时候', '现在', '可能', '需要', '应该', '非常', '真的', '很多', '大家', '东西', '地方',
  '问题', '方面', '方式', '情况', '时间', '一下', '起来', '出来', '一下', '直接', '基本', '目前', '之后', '之前']);

export function smartTags(body, existingTags = []) {
  const text = String(body || '');
  const freq = new Map();
  const bump = (t, w = 1) => { freq.set(t, (freq.get(t) || 0) + w); };

  const latin = text.match(/[A-Za-z][A-Za-z0-9+#./-]{2,24}/g) || [];
  for (const w of latin) {
    const lw = w.toLowerCase();
    if (EN_STOP.has(lw)) continue;
    bump(lw);
  }

  const runs = text.match(/[\u4e00-\u9fff]{2,}/g) || [];
  for (const run of runs) {
    if (run.length >= 2 && run.length <= 4 && !CN_STOP.has(run)) bump(run, 2); // short run = likely word
    const maxG = Math.min(4, run.length);
    for (let g = 2; g <= maxG; g++) {
      for (let i = 0; i + g <= run.length; i++) {
        const gram = run.slice(i, i + g);
        if (CN_STOP.has(gram)) continue;
        bump(gram, 1);
      }
    }
  }

  // longer CJK grams score higher (2-gram *1.3^0, 4-gram *1.3^2)
  const scored = [...freq.entries()]
    .filter(([t, n]) => n >= 2 && t.length >= 2)
    .map(([t, n]) => [t, n * (/[\u4e00-\u9fff]/.test(t) ? Math.pow(1.3, Math.min(4, t.length) - 2) : 1)])
    .sort((a, b) => b[1] - a[1]);

  // subsumption dedup: drop grams contained in a kept longer gram (and vice versa)
  const kept = [];
  for (const [t] of scored) {
    if (kept.some((u) => u !== t && u.includes(t))) continue;
    for (let i = kept.length - 1; i >= 0; i--) {
      if (t !== kept[i] && t.includes(kept[i])) kept.splice(i, 1);
    }
    kept.push(t);
  }

  // existing tags found in body get boosted to the front
  const present = existingTags.filter((t) => t && text.includes(t));
  const out = [...new Set([...present])];
  for (const t of kept) {
    if (out.length >= 8) break;
    if (!out.includes(t)) out.push(t);
  }
  return out.slice(0, 8);
}

export function mergeTags(a = [], b = []) {
  return [...new Set([...(a || []), ...(b || [])].filter(Boolean))];
}

// ---------- helpers ----------
export function guessTitle(body, filename) {
  const h1 = /^#\s+(.+)$/m.exec(body || '');
  if (h1) return h1[1].trim();
  const base = String(filename || '').split('/').pop() || '';
  return base.replace(/\.(md|markdown)$/i, '').replace(/[-_]+/g, ' ').trim();
}

// ---------- site scaffold templates ----------
export function defaultConfigToml(title) {
  return `baseURL = '/'
languageCode = 'zh-cn'
title = '${String(title).replace(/'/g, "''")}'
theme = ''

[params]
description = '由 HugoPad 创建的站点'
`;
}

export function archetypeMd() {
  return `---
title: '{{ replace .File.ContentBaseName "-" " " | title }}'
date: '{{ .Date }}'
draft: false
tags: []
categories: []
---
`;
}

export function gitignoreText() {
  return `public/
resources/_gen/
.hugo_build.lock
.DS_Store
`;
}

// Minimal builtin layouts so a fresh site (no theme yet) still builds & previews
export function builtinLayouts() {
  return {
    'layouts/_default/baseof.html': `<!doctype html>
<html lang="{{ .Site.LanguageCode }}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{ if .IsHome }}{{ .Site.Title }}{{ else }}{{ .Title }} · {{ .Site.Title }}{{ end }}</title>
</head>
<body>
<main>{{ block "main" . }}{{ end }}</main>
</body>
</html>
`,
    'layouts/_default/single.html': `{{ define "main" }}
<article>
<h1>{{ .Title }}</h1>
{{ with .Date }}<time>{{ .Format "2006-01-02" }}</time>{{ end }}
{{ with .Params.tags }}<p>{{ range . }}<code>#{{ . }}</code> {{ end }}</p>{{ end }}
{{ .Content }}
</article>
{{ end }}
`,
    'layouts/_default/list.html': `{{ define "main" }}
<h1>{{ .Title }}</h1>
<ul>
{{ range .Pages }}<li><a href="{{ .RelPermalink }}">{{ .Title }}</a></li>{{ end }}
</ul>
{{ end }}
`,
    'layouts/index.html': `{{ define "main" }}
<h1>{{ .Site.Title }}</h1>
{{ .Content }}
<ul>
{{ range .Site.RegularPages }}<li><a href="{{ .RelPermalink }}">{{ .Title }}</a></li>{{ end }}
</ul>
{{ end }}
`,
  };
}

export function welcomePost() {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `---
title: 'Hello HugoPad'
date: '${now}'
lastmod: '${now}'
draft: false
tags: ['Hugo', '示例']
categories: ['随笔']
summary: '第一篇由 HugoPad 创建的文章。'
---

欢迎使用 **HugoPad** 🎉

- 📝 写作：自动补全 Hugo front matter（标题/日期/标签）
- 🎨 主题：一键安装开源主题并预览
- 🔨 构建：内置 Hugo 引擎，本地即时预览
- ☁ 部署：提交并推送到 Git 仓库，配合腾讯 EdgeOne Pages 自动发布

\`\`\`bash
hugo server  # 电脑上也可以这样本地预览
\`\`\`

> 保存文章时，如果标签为空，HugoPad 会根据内容自动推荐标签。
`;
}

// ---------- config file theme switch ----------
export const CONFIG_FILES = ['hugo.toml', 'config.toml', 'hugo.yaml', 'config.yaml', 'hugo.yml'];

export function applyThemeToConfigText(text, themeName) {
  const t = String(text || '');
  const isToml = /\.toml$/i.test('') ? null : null; // decided by caller
  // try toml style first, then yaml style
  if (/^theme\s*=.*$/m.test(t)) return t.replace(/^theme\s*=.*$/m, `theme = '${themeName}'`);
  if (/^theme\s*:.*$/m.test(t)) return t.replace(/^theme\s*:.*$/m, `theme: ${themeName}`);
  // no theme key: insert before first section header ([xxx]) for toml, or at top
  const m = /^\[.*\]\s*$/m.exec(t);
  if (m) return t.slice(0, m.index) + `theme = '${themeName}'\n` + t.slice(m.index);
  return t + (t.endsWith('\n') ? '' : '\n') + `theme = '${themeName}'\n`;
}
