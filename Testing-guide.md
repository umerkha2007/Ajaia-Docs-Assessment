# Testing Guide

## Commands

| Command | What it runs |
|---|---|
| `npm test` | All Vitest tests (server + client projects), verbose per-test output |
| `npm run test:server` | Server project only (Node environment) |
| `npm run test:client` | Client project only (jsdom + React Testing Library) |
| `npm run test:e2e` | Playwright (a fixture signs `page` in as Alice; `asUser(id)` opens a second browser context signed in as another user) against its own `npm run dev` on ports 5273/3101 with a throwaway temp-dir database; safe to run while your own dev server is up |
| `$env:PW_CHANNEL='chrome'; npx playwright test --headed` (PowerShell) | E2E in a visible, installed Google Chrome |
| `npm run typecheck` | `tsc --noEmit` for client and server projects |
| `npm run lint` | ESLint |
| `npm run verify` | typecheck, lint, test, build (does not include E2E) |

## Organization

- Server tests: `server/src/__tests__/*.test.ts`. Client tests: `client/src/__tests__/*.test.tsx`. E2E: `e2e/*.spec.ts`.
- Tests are grouped with `describe` headings per feature (e.g. "Persistence: SQLite driver", "Backend API: health and routing"). Later phases add Document CRUD, Rich-Text Formatting, File Import, Ownership and Sharing, Validation and Error Handling, Integration and End-to-End.
- Every test name begins with an ID in brackets. The verbose reporter prints the project, file, group and name for each test.
- Database tests use `:memory:` or `mkdtemp` temp directories, never `data/app.db`.
- Tests are deterministic and need no network at run time.
- The editor is tested at four levels: schema/contract with a real headless Tiptap editor (`editorContract.test.ts`), toolbar behaviour with the real editor in jsdom (`RichTextEditor.test.tsx`), the surrounding screen with a stand-in editor (`DocumentEditor.test.tsx`; jsdom cannot drive real typing), and real keystrokes in a browser (`formatting.spec.ts`).

## Requirement-to-test mapping

The source requirements have no IDs; this scheme was introduced in Phase 1 and is extended per phase. "Executed, passing" means observed passing; dates and counts are in `Roadmap.md`.

| ID | Requirement | Tests (file) | Status |
|---|---|---|---|
| FR-1.1 | Create a document (owner = actor, default title, empty body) | `documents.service.test.ts`, `documents.api.test.ts`, `DocumentList.test.tsx`, `documents.spec.ts` | Executed, passing |
| FR-1.2 | Rename a document | service, api, `DocumentEditor.test.tsx`, `documents.spec.ts` | Executed, passing |
| FR-1.3 | Edit and save content | service, api, `DocumentEditor.test.tsx`, `documents.spec.ts`, `formatting.spec.ts` | Executed, passing |
| FR-1.4 | Reopen a saved document | service, api, `DocumentEditor.test.tsx`, `App.test.tsx`, `documents.spec.ts` (full reload) | Executed, passing |
| FR-1.5 | Delete a document | service, api, `DocumentList.test.tsx`, `documents.spec.ts` | Executed, passing |
| FR-1.6 | List ordering (newest update first) | service, api, `DocumentList.test.tsx`, `documents.spec.ts` | Executed, passing |
| FR-1.7 | Bold, italic, underline (apply, remove, combine); stored and restored | `editorContract.test.ts`, `RichTextEditor.test.tsx`, `contentSchema.test.ts`, `formattedContent.api.test.ts`, `formatting.spec.ts` | Executed, passing |
| FR-1.8 | Headings (levels 1-3), toggle back to paragraph, no level above 3 | same files | Executed, passing |
| FR-1.9 | Bulleted and numbered lists, nesting, toggling and switching type | same files | Executed, passing |
| FR-1.7-1.9, NFR-VAL | Pasting rich text: semantic HTML and Google-Docs-style HTML keep supported formatting; links, strike, code, tables, images, quotes are dropped with their text kept; nothing executes; pasted content saves and reloads | `paste.spec.ts` (real browser; paste is simulated with a paste event carrying HTML, not the OS clipboard) | Executed, passing |
| FR-2.1 | `.txt` import creates a new document owned by the importer, one paragraph per line, BOM and unicode handled | `import.convert.test.ts`, `import.file.test.ts`, `import.api.test.ts`, `import.spec.ts` | Executed, passing |
| FR-2.2 | `.md` import keeps headings, bold, italic, bulleted and numbered lists (nesting, start numbers); other Markdown degrades to text | same files | Executed, passing |
| FR-2.3 | Document title comes from the file name, without path or extension | `import.file.test.ts`, `import.api.test.ts` | Executed, passing |
| FR-2.4 | Unsupported file types are refused with a clear message and nothing is created | `import.file.test.ts`, `import.api.test.ts`, `importRules.test.ts`, `DocumentImport.test.tsx`, `import.spec.ts` | Executed, passing |
| FR-2.5 | Empty, whitespace-only, binary, non-UTF-8, oversized and over-complex files fail safely with clear messages | same files | Executed, passing |
| FR-2.6 | Imported content is editable, saved, and persisted across reload and restart | `import.api.test.ts`, `import.spec.ts` | Executed, passing |
| FR-2.7 | Supported types are stated in the UI and README | `DocumentImport.test.tsx`, `importRules.test.ts`, `import.spec.ts` (UI); README checked manually | Executed, passing (UI); README by inspection |
| FR-3.0 | Deterministic seeded users | `seed.test.ts` | Executed, passing |
| FR-3.1 | Every document has an explicit owner (NOT NULL foreign key, set from the signed-in user) | `documents.service.test.ts`, `documents.api.test.ts`, `sharing.api.test.ts` | Executed, passing |
| FR-4.1 | Documents, including formatting, survive an application restart | `documents.api.test.ts` and `formattedContent.api.test.ts` "Persistence" (close and reopen a file database); `documents.spec.ts` and `formatting.spec.ts` reload | Executed, passing |
| SEC-1 | Users without access cannot read, rename, edit, delete or manage sharing, and editors cannot delete or manage sharing; nothing changes | service, api, `policy.test.ts`, `sharing.service.test.ts`, `sharing.api.test.ts`, `documents.spec.ts`, `sharing.spec.ts` | Executed, passing |
| SEC-2 | Client-supplied owner or role is ignored | `documents.api.test.ts`, `sharing.api.test.ts`, `sharing.spec.ts` | Executed, passing |
| SEC-3 | Requests without a valid session get 401 (including the sharing routes) | `documents.api.test.ts`, `session.test.ts`, `sharing.api.test.ts` | Executed, passing |
| NFR-VAL | Titles, ids, file names, uploads and content validated against the schema allowlist (nodes, marks, attributes, depth, size); markup in typed, pasted or imported content is inert; failed validation leaves data unchanged | service, api, `contentSchema.test.ts`, `formattedContent.api.test.ts`, `editorContract.test.ts`, `DocumentEditor.test.tsx`, `documents.spec.ts`, `formatting.spec.ts`, `import.*.test.ts`, `import.spec.ts` | Executed, passing |
| NFR-ERR | Missing documents, malformed JSON, corrupt content, unexpected 500, failed save keeps typed text | service, api, `DocumentList.test.tsx`, `DocumentEditor.test.tsx` | Executed, passing. Storage-failure injection is Phase 6 |
| FR-5.1 | Opening a document loads the shared text; opening writes nothing; first open of an old document creates its shared state once (no duplicate paragraphs) | `sync.service.test.ts`, `sync.api.test.ts`, `RichTextEditor.test.tsx`, `DocSync.test.ts`, `collab.integration.test.ts`, `collaboration.spec.ts` | Executed, passing |
| FR-5.2 | Autosave: changes save by themselves (debounce plus poll), failures keep text and retry, leaving the page flushes, closing the tab warns | `DocSync.test.ts`, `DocumentEditor.test.tsx`, `collab.integration.test.ts`, `collaboration.spec.ts`, `editorContract.test.ts` | Executed, passing |
| FR-5.3 | Simultaneous edits merge: same paragraph, different paragraphs, formatting plus typing, three users, offline then reconnect, repeated or reordered updates; remote changes appear without moving the cursor | `sync.service.test.ts`, `sync.api.test.ts`, `DocSync.test.ts`, `RichTextEditor.test.tsx`, `editorContract.test.ts`, `collab.integration.test.ts`, `collaboration.spec.ts` | Executed, passing |
| FR-5.4 | Other ways of changing content (plain content API, import) stay consistent with the shared document | `sync.service.test.ts` | Executed, passing |
| FR-5.5 | Shared state persists across a restart; a corrupt state is reported, not silently replaced | `sync.service.test.ts`, `collab.integration.test.ts` | Executed, passing |
| FR-5.1 (edge) | A document stored with no blocks opens as exactly one empty paragraph for every client | `sync.service.test.ts` (2 cases, added during final acceptance after a mutation check showed this was untested) | Executed, passing |
| Phase 6 gap | Server-side database-failure injection (write fails, database locked, disk full) | none | **Not written** (Phase 6 skipped) |
| Phase 7 gap | One continuous two-user scenario following Plan.md Phase 7 step by step | none as a single test (the steps are covered separately above) | **Not written** (Phase 7 skipped) |
| UI | Visual design applied; labels, roles and ids unchanged | all component and browser tests; screens inspected by screenshot | Executed, passing. Visual match is by inspection, not automated |
| P1-* | Phase 1 infrastructure (SQLite driver, migrations, config, health, shell, startup) | `database.test.ts`, `app.test.ts`, `BackendStatus.test.tsx`, `smoke.spec.ts` | Executed, passing |
| FR-3.2 | Simulated sign-in: choose a seeded user, switch, sign out; identity survives reload and restart | `session.test.ts`, `App.test.tsx`, `sharing.spec.ts` | Executed, passing |
| FR-3.3 | Owner grants another user access (idempotent, owner-only, never to self or an unknown user) | `sharing.service.test.ts`, `sharing.api.test.ts`, `SharePanel.test.tsx`, `sharing.spec.ts` | Executed, passing |
| FR-3.4 | The recipient can open and edit the shared document; ownership never moves | `sharing.service.test.ts`, `sharing.api.test.ts`, `policy.test.ts`, `DocumentEditor.test.tsx`, `sharing.spec.ts` | Executed, passing |
| FR-3.5 | Owned and shared documents are visibly distinguished (separate sections, owner name, badges, no Delete on shared) | `sharing.service.test.ts`, `sharing.api.test.ts`, `DocumentList.test.tsx`, `DocumentEditor.test.tsx`, `sharing.spec.ts` | Executed, passing |
| FR-3.6 | Revocation takes effect immediately (read, write, list); other users unaffected; work saved before revocation kept | `sharing.service.test.ts`, `sharing.api.test.ts`, `SharePanel.test.tsx`, `DocumentEditor.test.tsx`, `sharing.spec.ts` | Executed, passing |
| FR-3.7 | Sharing persists across restart; deleting a document removes its shares; the database enforces roles and references | `sharing.service.test.ts`, `sharing.api.test.ts` (closes and reopens a file database), `sharing.spec.ts` (reload) | Executed, passing |
| SEC-4 | Session cookie is signed, tampering and forgery are rejected, the cookie is HttpOnly and SameSite=Lax, the secret persists in the database | `session.test.ts`, `sharing.spec.ts` | Executed, passing |

## Manual verification (through live editing)

1. `npm run dev`, open http://127.0.0.1:5173. Choose **Alice Anderson** on the "Choose a user" screen (simulated sign-in).
2. Click **New document**; rename it in the title box (press Enter); type text; click **Save** ("All changes saved"); refresh: title and text are still there.
3. Formatting: in a document, use the toolbar and shortcuts (Ctrl+B / I / U) for bold, italic, underline; H1, H2, H3; "• List" and "1. List". Press Enter twice in a list to leave it. Click Save, refresh: the formatting is restored. Toolbar buttons look pressed while the caret is inside matching formatting.
4. Import: click **Import file** and choose a `.md` file with headings, bold, italic, a bulleted and a numbered list; it opens as a new document with that formatting. Do the same with a `.txt` file. Try a `.pdf`, an empty `.txt`, and a PNG renamed to `.txt`: each shows a clear error and creates nothing. Save, refresh, and the imported document is still there.
5. Create a second document and save it; the list on `#/` shows it above the first. Delete one (confirm dialog) and check it disappears.
6. Sharing: as Alice open a document, use **Sharing** to share it with Bob Brown (the list shows him). Switch user to Bob: the document is under **Shared with you** with "Owner: Alice Anderson" and "Can edit", with no Delete button; open it, edit, Save. Switch back to Alice: Bob's edit is there and the list shows "Shared with 1". Switch to Carol: she sees neither document, and pasting the document's URL shows a permission error. As Alice, **Remove** Bob: as Bob the document is gone from the list and a still-open copy fails to save with a permission error (your text stays).
7. Live editing: open the same shared document as Alice in one browser window and as Bob in a private window. Type in both at once, even in the same paragraph: after a couple of seconds both windows show both people's text, with no Save click and no refresh. Rename the document in one window and watch the title change in the other. Turn off the network in one window (browser dev tools, Offline), type, turn it back on: the text is kept and saved.
8. API denial: sign in with `curl.exe -c jar.txt -H "content-type: application/json" -d "{\"userId\":\"user-bob\"}" http://127.0.0.1:3001/api/session`, then `curl.exe -i -b jar.txt http://127.0.0.1:3001/api/documents/<id>` returns 403 for a document Bob has no access to, and without `-b jar.txt` it returns 401.
9. Restart persistence: stop `npm run dev`, start it again, reload the page; the documents are still listed.
10. Stop only the backend, refresh: the footer shows "Backend unavailable: ..." and the list shows an error.
