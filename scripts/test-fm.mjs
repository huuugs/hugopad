// Node tests for pure front-matter / smart-tags logic
import { strict as assert } from 'node:assert';
import { parseDoc, buildDoc, smartTags, guessTitle, applyThemeToConfigText } from '../src-web/js/hugo.js';
import { slugify } from '../src-web/js/util.js';

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; }
}

console.log('parseDoc / buildDoc');

t('yaml front matter parse', () => {
  const doc = parseDoc(`---\ntitle: "Hello"\ndate: '2024-01-01T00:00:00Z'\ndraft: true\ntags: [a, "b c"]\n---\n\nBody here`);
  assert.equal(doc.type, 'yaml');
  assert.equal(doc.fm.title, 'Hello');
  assert.equal(doc.fm.draft, true);
  assert.deepEqual(doc.fm.tags, ['a', 'b c']);
  assert.ok(doc.body.includes('Body here'));
});

t('toml front matter parse', () => {
  const doc = parseDoc(`+++\ntitle = "Hi"\ndraft = false\ntags = ["x", "y"]\n+++\nbody`);
  assert.equal(doc.type, 'toml');
  assert.equal(doc.fm.title, 'Hi');
  assert.deepEqual(doc.fm.tags, ['x', 'y']);
});

t('no front matter', () => {
  const doc = parseDoc('just body');
  assert.equal(doc.type, null);
  assert.equal(doc.body, 'just body');
});

t('build yaml roundtrip', () => {
  const out = buildDoc('yaml', { title: 'T', date: 'D', draft: false, tags: ['a', 'b'] }, 'body');
  assert.ok(out.startsWith('---\n'));
  const doc = parseDoc(out);
  assert.equal(doc.fm.title, 'T');
  assert.equal(doc.fm.draft, false);
  assert.deepEqual(doc.fm.tags, ['a', 'b']);
  assert.equal(doc.body.replace(/^\n/, ''), 'body');
});

t('build toml roundtrip', () => {
  const out = buildDoc('toml', { title: 'T2', tags: ['中文'] }, 'b2');
  const doc = parseDoc(out);
  assert.equal(doc.fm.title, 'T2');
  assert.deepEqual(doc.fm.tags, ['中文']);
});

t('chinese title quoting safe', () => {
  const out = buildDoc('yaml', { title: '你好: 世界' }, 'x');
  const doc = parseDoc(out);
  assert.equal(doc.fm.title, '你好: 世界');
});

console.log('smartTags');

t('latin keyword freq', () => {
  const tags = smartTags('docker docker kubernetes kubernetes hugo once', []);
  assert.ok(tags.includes('docker'));
  assert.ok(tags.includes('kubernetes'));
  assert.ok(!tags.includes('hugo')); // freq 1 < 2
});

t('chinese 2-gram', () => {
  const tags = smartTags('人工智能人工智能很强大，人工智能改变了世界。神经网络神经网络也很重要。', []);
  assert.ok(tags.some((x) => x.includes('人工智能')));
  assert.ok(tags.some((x) => x.includes('神经网络')));
});

t('existing tags boosted', () => {
  const tags = smartTags('写了一点关于旅行旅行 的内容', ['旅行']);
  assert.equal(tags[0], '旅行');
});

console.log('misc');

t('guessTitle from h1', () => {
  assert.equal(guessTitle('# My Post\nrest', 'a/b.md'), 'My Post');
  assert.equal(guessTitle('', 'content/posts/my-file.md'), 'my file');
});

t('slugify', () => {
  assert.equal(slugify('Hello World! 123'), 'hello-world-123');
  assert.equal(slugify('中文标题'), '');
});

t('applyThemeToConfigText replace', () => {
  const next = applyThemeToConfigText("baseURL = '/'\ntheme = 'old'\n\n[params]\nx = 1\n", 'new-theme');
  assert.ok(next.includes("theme = 'new-theme'"));
  assert.ok(!next.includes("'old'"));
});

t('applyThemeToConfigText insert before section', () => {
  const next = applyThemeToConfigText("baseURL = '/'\n\n[params]\nx = 1\n", 'PaperMod');
  assert.ok(next.indexOf("theme = 'PaperMod'") < next.indexOf('[params]'));
});

console.log(`\n${passed} tests passed${process.exitCode ? ' (with failures!)' : ''}`);
