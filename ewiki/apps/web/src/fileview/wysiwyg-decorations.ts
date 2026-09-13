// ---------------------------------------------------------------------------
// Typora 式 Markdown WYSIWYG decorations
//   1. 隐藏语法标记 (# / ** / - / > / ` 等)
//   2. 富样式 (heading 大字号、blockquote 左边框、bold 加粗)
// ---------------------------------------------------------------------------
import { EditorView, Decoration, DecorationSet, ViewPlugin } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { Extension } from '@codemirror/state';

function baseType(name: string): string {
  return name.replace(/^Markdown/, '').replace(/Node$/, '');
}

function plugin(viewFn: (view: EditorView) => DecorationSet): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = viewFn(view);
      }
      update(u: any) {
        if (u.docChanged) this.decorations = viewFn(u.view);
      }
    },
    { decorations: (v: any) => v.decorations },
  );
}

/** Hide markdown syntax marks */
const hideMarks = plugin((view) => {
  const decos: Decoration[] = [];
  const cursor = syntaxTree(view.state).cursor();
  do {
    const t = baseType(cursor.name);
    const from = cursor.from;
    const text = view.state.doc.sliceString(from, cursor.to);
    switch (t) {
      case 'ATXHeading1': case 'ATXHeading2': case 'ATXHeading3':
      case 'ATXHeading4': case 'ATXHeading5': case 'ATXHeading6': {
        const m = text.match(/^(#+)(\s)/);
        if (m) decos.push(Decoration.replace({ from, to: from + m[1]!.length + 1 }));
        break;
      }
      case 'Blockquote': {
        const line = view.state.doc.lineAt(from);
        const lines = view.state.doc.sliceString(line.from, line.to).split('\n');
        let off = line.from;
        for (const ll of lines) {
          const m = ll.match(/^(\s*>+\s?)/);
          if (m) decos.push(Decoration.replace({ from: off, to: off + m[1]!.length }));
          off += ll.length + 1;
        }
        break;
      }
      case 'BulletList': case 'OrderedList': {
        const line = view.state.doc.lineAt(from);
        const lines = view.state.doc.sliceString(line.from, line.to).split('\n');
        let off = line.from;
        for (const ll of lines) {
          const m = ll.match(/^(\s*)([-*+]|\d+[.)])(\s)/);
          if (m) {
            const skip1 = m[1]!.length;
            const skip2 = m[2]!.length;
            decos.push(Decoration.replace({ from: off + skip1, to: off + skip1 + skip2 + 1 }));
          }
          off += ll.length + 1;
        }
        break;
      }
      case 'HorizontalRule': case 'CodeMark': case 'CodeInfoMark': {
        decos.push(Decoration.replace({ from, to: cursor.to }));
        break;
      }
    }
  } while (cursor.next());
  return Decoration.set(decos as any);
});

/** Rich block styles */
const blockStyles = plugin((view) => {
  const decos: Decoration[] = [];
  const cursor = syntaxTree(view.state).cursor();
  do {
    const t = baseType(cursor.name);
    const cls =
      t === 'ATXHeading1' ? 'cm-md-h1' :
      t === 'ATXHeading2' ? 'cm-md-h2' :
      t === 'ATXHeading3' ? 'cm-md-h3' :
      t === 'ATXHeading4' ? 'cm-md-h4' :
      t === 'ATXHeading5' ? 'cm-md-h5' :
      t === 'ATXHeading6' ? 'cm-md-h6' :
      t === 'Blockquote' ? 'cm-md-blockquote' :
      t === 'FencedCode' ? 'cm-md-codeblock' :
      t === 'BulletList' || t === 'OrderedList' ? 'cm-md-list' :
      '';
    if (cls) decos.push(Decoration.mark({ from: cursor.from, to: cursor.to, class: cls }));
  } while (cursor.next());
  return Decoration.set(decos as any);
});

/** Rich inline styles */
const inlineStyles = plugin((view) => {
  const decos: Decoration[] = [];
  const cursor = syntaxTree(view.state).cursor();
  do {
    const t = baseType(cursor.name);
    const cls =
      t === 'Emphasis' ? 'cm-md-emph' :
      t === 'StrongEmphasis' ? 'cm-md-strong' :
      t === 'InlineCode' ? 'cm-md-code' :
      t === 'Link' ? 'cm-md-link' :
      t === 'Strikethrough' ? 'cm-md-strike' :
      '';
    if (cls) decos.push(Decoration.mark({ from: cursor.from, to: cursor.to, class: cls }));
  } while (cursor.next());
  return Decoration.set(decos as any);
});

const themeCommon: Record<string, any> = {
  '&': { fontSize: '15px', lineHeight: '1.75' },
  '.cm-md-blockquote': { display: 'block', paddingLeft: '12px', margin: '0.3em 0', fontStyle: 'italic' },
  '.cm-md-codeblock': { display: 'block', borderRadius: '6px', padding: '0.8em 1em', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.9em' },
  '.cm-md-list': { display: 'block', margin: '0.2em 0', paddingLeft: '1.2em' },
  '.cm-md-strong': { fontWeight: 700 },
  '.cm-md-emph': { fontStyle: 'italic' },
  '.cm-md-strike': { textDecoration: 'line-through' },
  '.cm-md-code': { borderRadius: '4px', padding: '0 4px', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.9em' },
  '.cm-md-link': { textDecoration: 'underline' },
};

const lightTheme: Record<string, any> = {
  ...themeCommon,
  '.cm-md-h1': { fontSize: '2em', fontWeight: 700, color: '#111827', display: 'block', margin: '0.6em 0 0.2em', paddingBottom: '0.15em', borderBottom: '1px solid #e5e7eb' },
  '.cm-md-h2': { fontSize: '1.5em', fontWeight: 700, color: '#111827', display: 'block', margin: '0.5em 0 0.15em' },
  '.cm-md-h3': { fontSize: '1.25em', fontWeight: 600, color: '#1f2937', display: 'block', margin: '0.4em 0 0.1em' },
  '.cm-md-h4': { fontSize: '1.1em', fontWeight: 600, color: '#374151', display: 'block' },
  '.cm-md-blockquote': { ...themeCommon['.cm-md-blockquote'], borderLeft: '3px solid #d1d5db', color: '#6b7280' },
  '.cm-md-codeblock': { ...themeCommon['.cm-md-codeblock'], background: '#f3f4f6' },
  '.cm-md-code': { ...themeCommon['.cm-md-code'], background: '#f3f4f6', color: '#e11d48' },
  '.cm-md-link': { ...themeCommon['.cm-md-link'], color: '#2563eb' },
};

const darkTheme: Record<string, any> = {
  ...themeCommon,
  '.cm-md-h1': { fontSize: '2em', fontWeight: 700, color: '#f3f4f6', display: 'block', margin: '0.6em 0 0.2em', paddingBottom: '0.15em', borderBottom: '1px solid #374151' },
  '.cm-md-h2': { fontSize: '1.5em', fontWeight: 700, color: '#f3f4f6', display: 'block', margin: '0.5em 0 0.15em' },
  '.cm-md-h3': { fontSize: '1.25em', fontWeight: 600, color: '#e5e7eb', display: 'block', margin: '0.4em 0 0.1em' },
  '.cm-md-h4': { fontSize: '1.1em', fontWeight: 600, color: '#d1d5db', display: 'block' },
  '.cm-md-blockquote': { ...themeCommon['.cm-md-blockquote'], borderLeft: '3px solid #4b5563', color: '#9ca3af' },
  '.cm-md-codeblock': { ...themeCommon['.cm-md-codeblock'], background: '#1f2937' },
  '.cm-md-code': { ...themeCommon['.cm-md-code'], background: '#1f2937', color: '#fca5a5' },
  '.cm-md-link': { ...themeCommon['.cm-md-link'], color: '#60a5fa' },
};

export const typoraDecorations: Extension[] = [
  hideMarks,
  blockStyles,
  inlineStyles,
  EditorView.theme(lightTheme, { dark: false }),
  EditorView.theme(darkTheme, { dark: true }),
];
