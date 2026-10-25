# Ajaia Docs

A lightweight document editor MVP: React + TypeScript + Vite frontend, Node + Fastify backend, SQLite storage. It is in active development; see `Roadmap.md` for what is implemented and verified.

**Current state:** Phase 5 plus live editing and the visual design (added at the owner's request after Phase 5). After choosing a simulated seeded user (Alice, Bob or Carol) you can create, rename, edit (bold, italic, underline, headings 1-3, bulleted and numbered lists), save, reopen and delete documents, import `.txt` and `.md` files, and everything persists in SQLite. Owners can share a document with another seeded user (who can then edit it) and revoke that access, and the lists show owned and shared documents separately. Error-handling polish (Phase 6) and the final acceptance run (Phase 8) are still to do.

- Setup and run: `Local-setup.md`
- Deploying (Vercel frontend plus a Node host for the backend; **untested**, with caveats): `deployment_guide.md`
- Architecture: `Architecture.md`
- Tests: `Testing-guide.md`
- Status and next steps: `Roadmap.md`, `Plan.md`
- Change history: `Changelog.md`

## Live editing

Documents **save automatically** a moment after you stop typing, and **other people's changes appear within a couple of seconds**, with no refresh. If two people type in the same paragraph at the same time, both edits are kept (the merge works on individual characters, using the Yjs library). If the connection drops, your text stays on the page and is saved when it returns. Limits: changes are exchanged by checking the server about every 2 seconds (no instant push), and you cannot see other people's cursors.

## Users and sharing

There is no real login. The app asks you to **choose one of three seeded users** (no password) and remembers the choice in a signed, HttpOnly cookie; a switcher in the header changes user. This is a simulation for the demo, not production authentication.

- The **owner** of a document can share it with another user and remove that access at any time. Only the owner can delete it or manage sharing.
- A person it is shared with can **open, edit and rename** it. It appears under **Shared with you**, with its owner shown; your own documents are under **Your documents**.
- Access rules are enforced by the server on every request, not just hidden in the interface.

## File import

Use **Import file** on the documents page. **Supported types: `.txt` and `.md` only** (UTF-8 text, up to 512 KB). The file becomes a new, editable document owned by you, titled after the file name.

- `.txt`: each line becomes a paragraph; runs of blank lines become one empty paragraph.
- `.md`: headings (levels 4-6 become level 3), bold, italic, bulleted and numbered lists (nesting allowed) are kept. Links, images, code, quotes, tables, strike-through and raw HTML have no equivalent in the editor, so their text is kept as plain text and the markup is dropped.
- Not supported: `.docx`, PDF, other encodings such as UTF-16 (these are refused with a clear message).
