import { getSchema } from '@tiptap/core';
import type { Editor } from '@tiptap/react';
import { prosemirrorJSONToYDoc, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';
import { RichTextEditor } from '../editor/RichTextEditor';
import { editorExtensions, YJS_FIELD } from '../editor/extensions';

const schema = getSchema(editorExtensions);
const paragraphJson = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
/** A shared document pre-filled the way the server fills it. */
const ydocWith = (json: unknown) => prosemirrorJSONToYDoc(schema, json, YJS_FIELD);
const sharedJson = (ydoc: Y.Doc) => JSON.stringify(yXmlFragmentToProsemirrorJSON(ydoc.getXmlFragment(YJS_FIELD)));

async function setup(ydoc: Y.Doc = ydocWith(paragraphJson('hello')), editable = true) {
  let editor!: Editor;
  const view = render(<RichTextEditor ydoc={ydoc} editable={editable} onEditor={(e) => (editor = e)} />);
  await waitFor(() => expect(editor).toBeDefined());
  return { editor, ydoc, ...view };
}

describe('Rich-Text Formatting (UI): toolbar', () => {
  it('[FR-1.7] shows all required formatting controls', async () => {
    await setup();
    for (const name of ['Bold', 'Italic', 'Underline', 'Heading 1', 'Heading 2', 'Heading 3', 'Bulleted list', 'Numbered list']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('[FR-1.7] clicking Bold applies the mark to the selection, in the editor and in the shared document, and shows the button as pressed', async () => {
    const { editor, ydoc } = await setup();
    act(() => void editor.commands.selectAll());
    const bold = screen.getByRole('button', { name: 'Bold' });
    expect(bold).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(bold);
    await waitFor(() => expect(bold).toHaveAttribute('aria-pressed', 'true'));
    expect(JSON.stringify(editor.getJSON())).toContain('"marks":[{"type":"bold"}]');
    expect(sharedJson(ydoc)).toContain('"type":"bold"');
    fireEvent.click(bold);
    await waitFor(() => expect(bold).toHaveAttribute('aria-pressed', 'false'));
    expect(sharedJson(ydoc)).not.toContain('bold');
  });

  it('[FR-1.8] clicking Heading 2 turns the block into a level-2 heading', async () => {
    const { editor, ydoc } = await setup();
    act(() => void editor.commands.selectAll());
    fireEvent.click(screen.getByRole('button', { name: 'Heading 2' }));
    await waitFor(() => expect(editor.getJSON().content![0]).toMatchObject({ type: 'heading', attrs: { level: 2 } }));
    expect(screen.getByRole('button', { name: 'Heading 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Heading 1' })).toHaveAttribute('aria-pressed', 'false');
    expect(sharedJson(ydoc)).toContain('"type":"heading"');
  });

  it.each([
    ['Bulleted list', 'bulletList'],
    ['Numbered list', 'orderedList'],
  ])('[FR-1.9] clicking %s wraps the text in a %s', async (label, type) => {
    const { editor } = await setup();
    act(() => void editor.commands.selectAll());
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(editor.getJSON().content![0]).toMatchObject({ type }));
  });
});

describe('Autosave and Sync (UI): the editor and the shared document', () => {
  it('[FR-5.1] shows the content of the shared document', async () => {
    await setup(ydocWith(paragraphJson('Loaded text')));
    expect(screen.getByLabelText('Document content')).toHaveTextContent('Loaded text');
  });

  it('[FR-5.1] opening a document does not write to the shared document (otherwise every viewer would add changes)', async () => {
    const seeded = ydocWith(paragraphJson('untouched'));
    const events = vi.fn();
    seeded.on('update', events);
    await setup(seeded);
    await new Promise((r) => setTimeout(r, 50));
    expect(events).not.toHaveBeenCalled();
  });

  it('[FR-5.1] an empty shared document is shown as one empty paragraph without anything being written to it', async () => {
    const empty = new Y.Doc();
    const events = vi.fn();
    empty.on('update', events);
    await setup(empty);
    await new Promise((r) => setTimeout(r, 50));
    expect(events).not.toHaveBeenCalled();
    expect(empty.getXmlFragment(YJS_FIELD).length).toBe(0);
  });

  it('[FR-5.2] a local formatting change is written to the shared document as a local update, so it gets saved', async () => {
    const { editor, ydoc } = await setup();
    const origins: unknown[] = [];
    ydoc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));
    act(() => void editor.chain().selectAll().toggleItalic().run());
    await waitFor(() => expect(origins.length).toBeGreaterThan(0));
    expect(sharedJson(ydoc)).toContain('italic');
  });

  it('[FR-5.3] a change that arrives from another person appears in the editor without any user action', async () => {
    const { ydoc } = await setup(ydocWith(paragraphJson('shared text')));
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(ydoc));
    ((other.getXmlFragment(YJS_FIELD).get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, 'Bob wrote: ');
    act(() => Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(ydoc)), 'remote'));
    await waitFor(() => expect(screen.getByLabelText('Document content')).toHaveTextContent('Bob wrote: shared text'));
  });

  it('[FR-5.3] a remote change does not move the cursor of the person typing', async () => {
    const { editor, ydoc } = await setup(ydocWith(paragraphJson('abcdef')));
    act(() => void editor.commands.setTextSelection(7)); // after "abcdef"
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(ydoc));
    ((other.getXmlFragment(YJS_FIELD).get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, '>>> ');
    act(() => Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(ydoc)), 'remote'));
    await waitFor(() => expect(editor.getText()).toBe('>>> abcdef'));
    expect(editor.state.selection.from).toBe(11); // still at the end of the text, now shifted by the insertion
  });

  it('[FR-3.6] while not editable (loading, or access lost) the text cannot be changed and the toolbar is disabled', async () => {
    const { editor, rerender, ydoc } = await setup(ydocWith(paragraphJson('locked')), false);
    expect(editor.isEditable).toBe(false);
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
    rerender(<RichTextEditor ydoc={ydoc} editable />);
    await waitFor(() => expect(editor.isEditable).toBe(true));
    for (const b of screen.getAllByRole('button')) expect(b).toBeEnabled();
  });
});
