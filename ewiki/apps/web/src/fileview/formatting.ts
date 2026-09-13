// ---------------------------------------------------------------------------
// Markdown 格式化命令 — 用于 CM6 工具栏按钮 dispatch
// ---------------------------------------------------------------------------
import type { EditorView } from '@codemirror/view';
import { Text } from '@codemirror/state';

function dispatch(view: EditorView, spec: { changes?: any; selection?: any }): void {
  view.dispatch(view.state.update(spec));
}

/** Wrap selected text with prefix/suffix (or prefix only) */
export function wrapSelection(view: EditorView, prefix: string, suffix = prefix): boolean {
  const { state } = view;
  const allEmpty = state.selection.ranges.every((r) => r.empty);
  if (allEmpty) return false;
  const changes: Array<{ from: number; to: number; insert: Text }> = [];
  state.selection.ranges.forEach((range) => {
    if (range.empty) return;
    const text = state.doc.sliceString(range.from, range.to);
    changes.push({ from: range.from, to: range.to, insert: Text.of([prefix, text, suffix]) });
  });
  dispatch(view, { changes });
  return true;
}

/** Toggle line prefix (e.g. "- ", "> ", "1. ") on all selected lines */
export function toggleLinePrefix(view: EditorView, prefix: string): boolean {
  const { state } = view;
  const doc = state.doc;
  const lineStarts = new Set<number>();
  state.selection.ranges.forEach((range) => {
    const fromLine = doc.lineAt(range.from);
    const toLine = doc.lineAt(range.to);
    for (let i = fromLine.number; i <= toLine.number; i++) {
      lineStarts.add(doc.line(i).from);
    }
  });
  if (lineStarts.size === 0) return false;
  const firstLinePrefix = doc.sliceString(doc.lineAt(state.selection.main.from).from, doc.lineAt(state.selection.main.from).from + prefix.length);
  const hasPrefix = firstLinePrefix === prefix;
  const sorted = Array.from(lineStarts).sort((a, b) => b - a);
  const changes: Array<{ from: number; to: number; insert: Text }> = [];
  sorted.forEach((pos) => {
    const line = doc.lineAt(pos);
    if (hasPrefix) {
      if (doc.sliceString(line.from, line.from + prefix.length) === prefix) {
        changes.push({ from: line.from, to: line.from + prefix.length, insert: Text.of(['']) });
      }
    } else {
      changes.push({ from: line.from, to: line.from, insert: Text.of([prefix]) });
    }
  });
  if (changes.length === 0) return false;
  dispatch(view, { changes });
  return true;
}

/** Insert markdown link, pre-fill selected text as link text */
export function insertLink(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  const text = range.empty ? 'text' : state.doc.sliceString(range.from, range.to);
  dispatch(view, {
    changes: { from: range.from, to: range.to, insert: Text.of([`[${text}](https://placeholder)`]) },
  });
  return true;
}

export function insertInlineCode(view: EditorView): boolean {
  return wrapSelection(view, '`');
}

export function toggleCodeBlock(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  const text = range.empty ? '' : state.doc.sliceString(range.from, range.to);
  dispatch(view, {
    changes: { from: range.from, to: range.to, insert: Text.of(['```', text || '// code', '```']) },
  });
  return true;
}

export function insertHorizontalRule(view: EditorView): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  dispatch(view, { changes: { from: line.from, to: line.from, insert: Text.of(['---', '']) } });
  return true;
}

/** Cycle heading level: none → H1 → H2 → ... → H6 → none */
export function toggleHeading(view: EditorView): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const content = state.doc.sliceString(line.from, line.to);
  const m = content.match(/^(#{1,6})\s+(.*)$/);
  let newContent: string;
  if (m) {
    const lvl = m[1]!.length;
    newContent = lvl >= 6 ? (m[2] ?? '') : '#'.repeat(lvl + 1) + ' ' + m[2];
  } else {
    newContent = '# ' + content;
  }
  dispatch(view, { changes: { from: line.from, to: line.to, insert: Text.of([newContent]) } });
  return true;
}

export function wrapStrikethrough(view: EditorView): boolean {
  return wrapSelection(view, '~~');
}
