// Pure DOM/string helpers (no Capacitor deps, safe to import in Node tests)

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  const flat = (c) => {
    for (const x of c) {
      if (x == null || x === false) continue;
      if (Array.isArray(x)) flat(x);
      else el.append(x.nodeType ? x : document.createTextNode(String(x)));
    }
  };
  flat(children);
  return el;
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.style.display = 'none'; }, ms);
}

export function slugify(s) {
  const ascii = String(s || '').toLowerCase().match(/[a-z0-9]+/g);
  return ascii ? ascii.join('-').slice(0, 64) : '';
}

export function fmtDate(d = new Date()) {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function b64ToU8(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export function u8ToB64(u8) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  }
  return btoa(s);
}

// Lightweight modal. fields: [{key,label,type,value,options,placeholder,required,checked}]
export function modal({ title, fields = [], html = '', okText = '确定', cancelText = '取消', onOk }) {
  const mask = h('div', { class: 'modal-mask' });
  const box = h('div', { class: 'modal' });
  const form = h('form');
  form.addEventListener('submit', (e) => e.preventDefault());

  for (const f of fields) {
    const lab = h('label', { class: 'field' });
    lab.append(h('span', {}, f.label || f.key));
    let input;
    if (f.type === 'select') {
      input = h('select', { dataset: { key: f.key } },
        (f.options || []).map((o) => h('option', { value: o.value ?? o, selected: (f.value ?? '') === (o.value ?? o) ? '' : null }, o.label ?? o)));
    } else if (f.type === 'textarea') {
      input = h('textarea', { rows: f.rows || 3, placeholder: f.placeholder || '', dataset: { key: f.key } }, f.value ?? '');
    } else if (f.type === 'checkbox') {
      input = h('input', { type: 'checkbox', dataset: { key: f.key }, checked: !!f.checked });
      lab.append(input, ' ', h('span', { style: 'display:inline' }, f.label || f.key));
      input._isCheckbox = true;
    } else {
      input = h('input', {
        type: f.type || 'text', value: f.value ?? '', placeholder: f.placeholder || '',
        dataset: { key: f.key }, required: f.required ? '' : null,
      });
    }
    if (f.type !== 'checkbox') lab.append(input);
    form.append(lab);
  }
  if (html) form.append(h('div', { html }));

  const close = () => mask.remove();
  const btns = h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:12px' },
    h('button', { type: 'button', onclick: close }, cancelText),
    h('button', { class: 'primary', type: 'submit' }, okText),
  );
  form.append(btns);
  form.addEventListener('submit', () => {
    const values = {};
    for (const f of fields) {
      const el = form.querySelector(`[data-key="${f.key}"]`);
      if (!el) continue;
      values[f.key] = f.type === 'checkbox' ? el.checked : el.value;
    }
    Promise.resolve(onOk(values, close)).catch((e) => toast('出错: ' + e.message));
  });
  box.append(h('h3', {}, title), form);
  mask.append(box);
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
  document.body.append(mask);
  const first = form.querySelector('input:not([type=checkbox]), textarea, select');
  if (first) first.focus();
  return { close };
}
