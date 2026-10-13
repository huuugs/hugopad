// CodeMirror 6 editor + markdown toolbar helpers
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';

export function createEditor(parent, { fontSize = 15, onDirty = null } = {}) {
  const extensions = [
    basicSetup,
    markdown({ base: markdownLanguage, addKeymap: true }),
    EditorView.lineWrapping,
    EditorView.theme({
      '&': { fontSize: fontSize + 'px', height: '100%' },
      '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
    }),
  ];
  if (onDirty) extensions.push(EditorView.updateListener.of((u) => { if (u.docChanged) onDirty(); }));
  return new EditorView({ parent, doc: '', extensions });
}

export function setDoc(view, text) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: String(text ?? '') } });
}

export function getDoc(view) {
  return view.state.doc.toString();
}

export function wrapSel(view, before, after = before) {
  view.dispatch(view.state.changeByRange((range) => {
    const text = view.state.sliceDoc(range.from, range.to);
    return {
      changes: { from: range.from, to: range.to, insert: before + text + after },
      range: { anchor: range.from + before.length, head: range.to + before.length },
    };
  }));
  view.focus();
}

export function prefixSel(view, prefix) {
  const { state } = view;
  const changes = [];
  const seen = new Set();
  for (const r of state.selection.ranges) {
    let pos = r.from;
    const lastLine = state.doc.lineAt(r.to).number;
    for (;;) {
      const line = state.doc.lineAt(pos);
      if (!seen.has(line.number)) {
        seen.add(line.number);
        changes.push({ from: line.from, insert: prefix });
      }
      if (line.number >= lastLine) break;
      pos = line.to + 1;
    }
  }
  const anchor = state.selection.main.from + prefix.length;
  view.dispatch({ changes, selection: { anchor } });
  view.focus();
}

export function insertAtCursor(view, text) {
  const r = view.state.selection.main;
  view.dispatch({
    changes: { from: r.from, to: r.to, insert: text },
    selection: { anchor: r.from + text.length },
  });
  view.focus();
}
