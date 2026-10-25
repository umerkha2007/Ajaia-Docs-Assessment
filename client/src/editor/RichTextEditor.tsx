import Collaboration from '@tiptap/extension-collaboration';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { useEffect, useMemo } from 'react';
import type * as Y from 'yjs';
import { editorExtensions, YJS_FIELD } from './extensions';

interface Props {
  /** The shared document this editor shows and edits. Content arrives through it, not through a prop. */
  ydoc: Y.Doc;
  /** False while the document is still loading or after access was lost. */
  editable: boolean;
  /** Called once the editor instance exists (used by tests to drive it). */
  onEditor?: (editor: Editor) => void;
}

interface ToolbarButton {
  label: string;
  title: string;
  isActive: (e: Editor) => boolean;
  run: (e: Editor) => void;
}

const BUTTONS: ToolbarButton[] = [
  { label: 'Bold', title: 'Bold (Ctrl+B)', isActive: (e) => e.isActive('bold'), run: (e) => e.chain().focus().toggleBold().run() },
  { label: 'Italic', title: 'Italic (Ctrl+I)', isActive: (e) => e.isActive('italic'), run: (e) => e.chain().focus().toggleItalic().run() },
  { label: 'Underline', title: 'Underline (Ctrl+U)', isActive: (e) => e.isActive('underline'), run: (e) => e.chain().focus().toggleUnderline().run() },
  { label: 'Heading 1', title: 'Heading 1', isActive: (e) => e.isActive('heading', { level: 1 }), run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { label: 'Heading 2', title: 'Heading 2', isActive: (e) => e.isActive('heading', { level: 2 }), run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: 'Heading 3', title: 'Heading 3', isActive: (e) => e.isActive('heading', { level: 3 }), run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { label: 'Bulleted list', title: 'Bulleted list', isActive: (e) => e.isActive('bulletList'), run: (e) => e.chain().focus().toggleBulletList().run() },
  { label: 'Numbered list', title: 'Numbered list', isActive: (e) => e.isActive('orderedList'), run: (e) => e.chain().focus().toggleOrderedList().run() },
];

function Toolbar({ editor, enabled }: { editor: Editor; enabled: boolean }) {
  // useEditor does not re-render on every transaction; subscribe to just the active flags.
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => BUTTONS.map((b) => b.isActive(e)),
  });
  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      {BUTTONS.map((b, i) => (
        <button
          key={b.label}
          type="button"
          title={b.title}
          aria-label={b.label}
          aria-pressed={active[i]}
          className={active[i] ? 'active' : undefined}
          disabled={!enabled}
          // Keep focus and the selection in the editor; otherwise the click blurs it and
          // keystrokes typed right after are lost while focus is restored.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => b.run(editor)}
        >
          {b.label === 'Bold' ? <strong>B</strong>
            : b.label === 'Italic' ? <em>I</em>
            : b.label === 'Underline' ? <u>U</u>
            : b.label === 'Bulleted list' ? '• List'
            : b.label === 'Numbered list' ? '1. List'
            : b.label.replace('Heading ', 'H')}
        </button>
      ))}
    </div>
  );
}

export function RichTextEditor({ ydoc, editable, onEditor }: Props) {
  // Collaboration binds the editor to the shared document, merges other people's edits into
  // the live view without moving your cursor, and provides undo that only reverts your own edits.
  const extensions = useMemo(() => [...editorExtensions, Collaboration.configure({ document: ydoc, field: YJS_FIELD })], [ydoc]);
  const editor = useEditor(
    {
      extensions,
      editable,
      editorProps: {
        attributes: { 'aria-label': 'Document content', 'aria-multiline': 'true', class: 'editor-surface' },
      },
    },
    [extensions],
  );

  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    if (editor) onEditor?.(editor);
  }, [editor, onEditor]);

  if (!editor) return null;
  return (
    <div className="rich-editor">
      <Toolbar editor={editor} enabled={editable} />
      <EditorContent editor={editor} />
    </div>
  );
}
