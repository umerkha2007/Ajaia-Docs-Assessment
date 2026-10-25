# Roadmap

Last updated: 2026-10-25 16:45 PDT (UTC-07:00). Only items with observed evidence are marked verified.

## Phase status

| Phase | Status | Evidence |
|---|---|---|
| 1. Scaffold, architecture, test setup | Complete (pending owner review) | See "Phase 1 verification" |
| 2. Document CRUD and persistence | Complete (pending owner review) | See "Phase 2 verification" |
| 3. Rich-text editor | Complete (pending owner review) | See "Phase 3 verification" |
| 4. File upload (.txt, .md) | Complete (pending owner review) | See "Phase 4 verification" |
| 5. Seeded users and sharing | Complete (pending owner review) | See "Phase 5 verification" |
| 6. Error handling and test completion | Skipped (time constraint) | Owner decision. See "Phases 6 and 7: what was and was not covered" |
| 7. Integration and usability | Skipped (time constraint) | Owner decision. See "Phases 6 and 7: what was and was not covered" |
| 8. Documentation and final verification | Complete (with documented gaps) | See "Final acceptance (Phase 8)" |

## Phase 1 verification (commands actually run, 2026-10-25, Windows 11, Node 26.8.2, npm 12.0.2)

| Command | Result |
|---|---|
| `npm run verify` (typecheck, lint, test, build) | Exit 0. Vitest: 3 files, 16 tests passed, 0 failed, 0 skipped. Vite build succeeded |
| `npm run test:e2e` | 1 passed (Chromium), 0 failed |
| `npm run dev:server` / `npm run dev:client` (manual, 15 s each) | Backend listened on 127.0.0.1:3001; Vite reported ready on 5173 |
| `npm audit` | 0 vulnerabilities |
| `PW_CHANNEL=chrome npx playwright test --headed` (installed Google Chrome), 2026-10-25 14:53 PDT (UTC-07:00) | **First run: 1 failed** (error text not captured). Immediate re-run: 1 passed. Suspected startup race (Playwright waited for Vite only). Added a wait for the backend's "Server listening" log; afterwards 3 consecutive headed Chrome runs: 3 passed. The race theory is not proven, since the original failure was not captured |

Not verified: `npm start` was not run on its own; the production build is client-only and is not served by the backend; behaviour on a Node version other than 26.8.2; macOS/Linux.

Issues found and fixed during Phase 1: ESLint `preserve-caught-error` in `migrate.ts` (added `cause`); the first E2E run timed out because Vite was not reachable on `127.0.0.1` (fixed by binding `127.0.0.1` in `vite.config.ts`).

## Final acceptance (Phase 8), 2026-10-25 16:45 PDT (UTC-07:00)

**Verdict.** The core product works and has been verified as described below. **I am not declaring the MVP complete**, because `Agents.md` section 8 forbids that while a mandatory item is unverified, and Phase 6 (database-failure handling) was skipped. What is true: every functional requirement in `Requirements.md` is implemented and has automated tests that pass; the remaining gaps are listed explicitly.

### Commands run for this acceptance (all on Windows 11, Node 26.8.2)

| Command | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 problems (the `UI/` mockup folder is excluded) |
| `npm test` | 27 files, **490 tests passed**, 0 failed, 0 skipped (server 352, client 138) |
| `npm run build` | Succeeded |
| `npm run test:e2e` (Chromium) | **51 passed** on each of three consecutive runs. One earlier run in the same session reported 50 passed and 1 failed (a text-content assertion); I did not capture which test, it did not recur in the three following runs, and I have **not** found its cause. Treat the browser suite as occasionally flaky |
| `PW_CHANNEL=chrome npx playwright test --headed` (installed Chrome) | 51 passed |
| `npm audit` | 0 vulnerabilities |
| Mutation checks on the live-editing code | Skipping merged-content validation (25 tests failed), not saving merges (28), echoing remote updates back (9), never sending local changes (20): all caught. Dropping the write-permission check for sync: **not caught, and cannot be**, because the only share role can both read and write (an equivalent change). Allowing an empty shared document: **not caught at first**, a real test gap; I added two tests, and they fail under that change and pass on the real code |

### Reconciliation with `Agents.md` section 8

| # | Requirement | Result |
|---|---|---|
| 1 | Full automated suite | Run, passing (above) |
| 2 | Lint, type check, production build | Run, passing (above) |
| 3 | Create, rename, edit, save, reopen, persistence after refresh or restart | Verified by unit, API and browser tests, including closing and reopening a file database. **Not done:** manually stopping and restarting `npm run dev` |
| 4 | Supported imports and unsupported-file errors | Verified (`import.*` tests, `import.spec.ts`) |
| 5 | Rich text and structure survive reload | Verified (`formatting.spec.ts`, `paste.spec.ts`, round-trip tests) |
| 6 | Ownership, sharing, revocation, access restrictions with different seeded users | Verified (`sharing.*` tests, `sharing.spec.ts`, `collaboration.spec.ts`) |
| 7 | Set up without paid services | **Partly verified.** Every dependency is free and open source and nothing contacts an external service when the app runs. I did not repeat a clean-machine install, and did not run the tests with the network off. `npm install` and the one-time `npx playwright install chromium` need the network |
| 8 | Every functional requirement reconciled with tests | Done: the table in `Testing-guide.md` (FR-1 to FR-5, SEC, NFR) |
| 9 | All six required documents current | Done in this stage (see `Changelog.md`) |
| 10 | Report defects, gaps, results, commands, setup, remaining work | This section, plus "Known limitations" and "Next steps" below |

### Requirement coverage (from `Requirements.md`)

| Requirement | Status |
|---|---|
| 1. Create, rename, edit in the browser, save and reopen; bold, italic, underline, headings, bulleted and numbered lists | Implemented and tested |
| 2. File upload that becomes an editable document; limit stated in UI and README | `.txt` and `.md` only, implemented and tested; the limit is stated in the UI and README. `.docx` not implemented |
| 3. Owner, a way to grant access, visible owned-versus-shared distinction | Implemented and tested (owner can grant and revoke an editor role) |
| 4. Persistence of documents and sharing; formatting preserved; sharing behaviour demonstrable | Implemented and tested (SQLite) |
| Deliverables: source code, README with setup, short architecture note, AI workflow note | Source, `README.md`, `Local-setup.md` and `Architecture.md` exist. **An AI workflow note does not exist**: the brief asks for one and it was not written. `deployment_guide.md` was added |

### Phases 6 and 7: what was and was not covered

Both phases were **skipped by owner decision because of the time constraint**. They were not done as phases; this records what the other phases happen to cover.

| Phase 6 item | Evidence |
|---|---|
| Failed saves give an understandable error without silently losing data | Covered at the browser level: `DocSync.test.ts`, `DocumentEditor.test.tsx`, and the offline test in `collaboration.spec.ts` (text kept, retried, saved when the network returns). **Not covered:** a failing database write on the server (disk full, locked database); only a generic unexpected-failure test exists (`documents.api.test.ts`, 500 with no details leaked) |
| Invalid titles and inputs rejected | Covered (`documents.service.test.ts`, `contentSchema.test.ts`, `sync.service.test.ts`, import tests) |
| Missing documents handled safely | Covered (404 and 400 tests in service, API and UI) |
| Unsupported uploads rejected | Covered (`import.file.test.ts`, `import.api.test.ts`, `import.spec.ts`) |
| Unauthorized reads and writes rejected | Covered (`policy`, `sharing.*`, `sync.*` tests, `sharing.spec.ts`) |
| Existing tests continue to pass | Yes (above) |
| **Open:** a review of error handling across all routes, and failure-injection tests for database errors | Not done |

| Phase 7 item | Evidence |
|---|---|
| User A creates, formats, saves, verifies persistence after refresh | `documents.spec.ts`, `formatting.spec.ts` |
| Imports a supported file | `import.spec.ts` |
| Shares with User B; B opens it | `sharing.spec.ts`, `collaboration.spec.ts` |
| B cannot access unshared documents | `sharing.spec.ts` (Carol) |
| A revokes and access is denied | `sharing.spec.ts`, `collaboration.spec.ts` |
| Complete suite run | Yes (above) |
| **Open:** one continuous end-to-end scenario following exactly the Plan.md steps; a usability and navigation review; keyboard-only and screen-reader checks; narrow and mobile layouts | Not done |

### Defects and risks known at hand-off

- One unexplained intermittent failure in the browser suite (above).
- No database-failure handling tests (Phase 6 gap).
- No AI workflow note (a stated deliverable).
- The session cookie has no `Secure` flag and sign-in is simulated (documented); not suitable for real data.
- Live editing polls every 2 seconds, has no cursors or presence, and its stored history grows without compaction; not load-tested.
- Node 26.8.2 and Windows are the only tested environment. Deployment to Vercel and Render is **untested** (`deployment_guide.md`); the free Render plan loses all data on restart.
- The backend does not serve the built frontend, so a single-service deployment needs a code change that has not been made.
- The interface follows the mockups in `UI/` by inspection only (not pixel-compared); some mockup features were deliberately not built.
- Upgrading a database file created in earlier phases was tested only from fresh databases.

## Added after Phase 5: live editing and the visual design (2026-10-25 16:20 PDT (UTC-07:00))

These were requested by the owner on top of the eight phases. Phase statuses above are unchanged.

| Command | Result |
|---|---|
| `npm run verify` (typecheck, lint, test, build) | Exit 0. Vitest: 27 files, 488 tests passed, 0 failed, 0 skipped (server 350, client 138). Build succeeded |
| `npm run test:e2e` (Chromium) | 51 passed, 0 failed on the final run (includes 12 new collaboration tests and the sharing tests updated for autosave) |
| `npm audit` | 0 vulnerabilities |

What was built: autosave and character-level merging of simultaneous edits (Yjs over HTTP polling), a sync endpoint with server-side validation of merged content, migration 003, a shared editor schema, a sync engine in the browser, status messages for saving, retrying and lost access, and the visual design from the mockups.

Problems found and fixed while doing it:
- `npm run dev` broke when I added a Node flag before `watch` in the script (tsx treated `watch` as a file name). Fixed by putting the flag after `watch`; verified the server starts without warnings.
- A new E2E test selected text with a word-wise shortcut that did not select what I expected; the test, not the app, was wrong (the behaviour is covered by server and integration tests). It now selects characters explicitly and passes.
- Existing E2E tests assumed the transient "Unsaved changes" state and a manual Save; with autosave they were changed (autosave is asserted instead; the revoked-editor test now blocks the network so the editor's text is genuinely unsaved when access is removed). Their intent is unchanged.
- Yjs prints a Node `localStorage` experimental warning; silenced with `--no-experimental-webstorage` in the dev scripts and the test config.

**Not verified (please read):**
- I did **not** run mutation checks (break the code, confirm tests fail) for the live-editing code, as I did for earlier phases. The tests passed, but I have not shown that they would catch every kind of breakage.
- The headed Google Chrome run was not repeated after these changes.
- No load or long-session testing: the Yjs history only grows, the server rebuilds the document on every sync call, and polling is every 2 s per open editor.
- Two users can still edit the same text only as fast as polling (about 2 s); there is no live cursor or presence indicator.
- The interface was checked by looking at screenshots of sign-in, documents, editor and sharing, not pixel-compared. Mockup features that the product does not have were not built (search, outline, view-only role, drag-and-drop import dialog with progress, undo toast, fourth user). Narrow and mobile layouts were not tested.
- An existing `data/app.db` created before migration 003 should upgrade automatically; I only tested upgrades from fresh databases.

## Phase 5 verification (commands actually run, 2026-10-25 15:55 PDT (UTC-07:00))

| Command | Result |
|---|---|
| `npm run verify` (typecheck, lint, test, build) | Exit 0. Vitest: 23 files, 387 tests passed, 0 failed, 0 skipped (server 294, client 93). Build succeeded |
| `npm run test:e2e` (Chromium) | 39 passed, 0 failed (5 document, 6 formatting, 5 paste, 11 import, 11 sign-in and sharing, 1 smoke). Run twice: 39/39 both times |
| `PW_CHANNEL=chrome npx playwright test --headed` | 39 passed, 0 failed |
| Mutation checks (change code, confirm tests fail, revert) | Editors allowed to delete and share (6 tests failed); session signature not checked (5); share records ignored when computing access (13); sharing with yourself allowed (2); revoke made a no-op (5); `ON DELETE CASCADE` removed (2); share list readable by non-owners (2). All were caught; every change was reverted and the suite re-verified (294 server tests passing) |
| `npm audit` | 0 vulnerabilities |

Per-file Vitest counts: server `database` 8, `app` 5, `seed` 2, `documents.service` 38, `documents.api` 16, `contentSchema` 35, `formattedContent.api` 5, `import.convert` 27, `import.file` 43, `import.api` 18, `session` 33, `policy` 17, `sharing.service` 33, `sharing.api` 14; client `BackendStatus` 3, `App` 10, `DocumentList` 12, `DocumentEditor` 12, `RichTextEditor` 6, `editorContract` 16, `importRules` 18, `DocumentImport` 9, `SharePanel` 7.

What changed in Phase 5: the temporary `x-user-id` header was removed and replaced by a signed, HttpOnly session cookie; migration 002 (`document_shares`, `app_settings`); policy now includes editor shares; the document service gained share, unshare, listShares and listShared; the list endpoint returns owned and shared documents; the UI gained a sign-in screen, a user switcher, "Shared with you", share badges, an access note and an owner-only Sharing panel. About 20 existing server, client and E2E tests were converted from the header to the cookie (the assertions were not weakened); the E2E tests now start signed in as Alice through a fixture.

Notes:
- The phase-1 test `app.test.ts` still builds an app on a bare in-memory database; this works because the signing secret is created lazily, on first use.
- A user's `data/app.db` created in earlier phases is migrated automatically on the next backend start; I did not run that upgrade path against a pre-existing file, only against fresh databases.

Not verified: any real multi-process or multi-machine use; cookie behaviour behind HTTPS or a different host name (no `Secure` flag, the app is for localhost); cookie expiry (sessions do not expire); concurrent edits by two users on the same document (the last save wins, there is no merge or conflict warning).

## Phase 4 verification (commands actually run, 2026-10-25 15:40 PDT (UTC-07:00))

| Command | Result |
|---|---|
| `npm run verify` (typecheck, lint, test, build) | Exit 0. Vitest: 18 files, 267 tests passed, 0 failed, 0 skipped (server 197, client 70). Build succeeded |
| `npm run test:e2e` (Chromium) | 28 passed, 0 failed (5 document, 6 formatting, 5 paste, 11 import, 1 smoke). Run twice: 28/28 both times |
| `PW_CHANNEL=chrome npx playwright test --headed` | 28 passed, 0 failed |
| Mutation checks (change code, confirm tests fail, revert) | Server: dropping the NUL-byte check (2 tests failed), non-fatal UTF-8 decoding (1), no heading clamp (1), accepting any extension (18), keeping link URLs as text (2). Client: accepting any extension in the pre-check (10 failed). All were caught; every change was reverted and the suite re-verified |
| `npm audit` | 0 vulnerabilities |

Per-file Vitest counts: server `database` 8, `app` 5, `seed` 2, `documents.service` 38, `documents.api` 16, `contentSchema` 35, `formattedContent.api` 5, `import.convert` 27, `import.file` 43, `import.api` 18; client `BackendStatus` 3, `App` 3, `DocumentList` 7, `DocumentEditor` 8, `RichTextEditor` 6, `editorContract` 16, `importRules` 18, `DocumentImport` 9.

Issues found and fixed in Phase 4:
- The tooling that wrote my source files turned two `\u` escapes (a byte-order mark in a regex and a zero-width space in a test) into literal characters, which ESLint flagged as irregular whitespace. Replaced them with `charCodeAt(0) === 0xfeff` and `String.fromCharCode(0x200b)`. A scan of the server sources found no other literal invisible characters.
- A test I wrote claimed to check "exactly the size limit" but did not; corrected to a body of exactly 512 KB.

Not verified: behaviour of `marked` on adversarial Markdown designed to be slow (pathological regular-expression input); the 512 KB cap bounds it, but no timing test was run. Files in encodings other than UTF-8 are refused, not converted. Real OS file-picker interaction was exercised through Playwright's file injection, not a native dialog. `.docx` import is deliberately not implemented.

## Phase 3 verification (commands actually run, 2026-10-25 15:20 PDT (UTC-07:00))

| Command | Result |
|---|---|
| `npm run verify` (typecheck, lint, test, build) | Exit 0. Vitest: 13 files, 152 tests passed, 0 failed, 0 skipped (server 109, client 43). Build succeeded |
| `npm run test:e2e` (Chromium) | 12 passed, 0 failed (5 document, 6 formatting, 1 smoke). Also run 3 more times during development with 12/12 each time |
| `PW_CHANNEL=chrome npx playwright test --headed` | 12 passed, 0 failed |
| Mutation checks | (A) allowed the `link` mark in the server validator: initially **not caught** (the existing link test also had attributes, which are rejected separately). Added a `link without attrs` test, re-ran: 1 failure as expected. (B) re-enabled the Link extension in the editor: initially **not caught** (Tiptap's own Link blocks `javascript:` URLs). Changed the paste test to include an `https` link too, re-ran: 1 failure as expected. Both changes were reverted and the suite re-verified |
| `npm audit` | 0 vulnerabilities |

Per-file Vitest counts: server `database` 8, `app` 5, `seed` 2, `documents.service` 38, `documents.api` 16, `contentSchema` 35, `formattedContent.api` 5; client `BackendStatus` 3, `App` 3, `DocumentList` 7, `DocumentEditor` 8, `RichTextEditor` 6, `editorContract` 16.

Added after the Phase 3 report (2026-10-25 15:25 PDT (UTC-07:00)): `e2e/paste.spec.ts`, 5 browser tests for pasting rich text (semantic HTML, Google-Docs-style spans, save and reload of pasted content, unsupported formatting dropped with text kept and no script execution, paste at the caret). `npm run test:e2e` now has 17 tests. Mutation check: re-enabling the link and strike extensions made the unsupported-formatting test fail as expected (4 passed, 1 failed); reverted and re-verified. Limitation: paste is simulated by dispatching a paste event with HTML, not through the operating-system clipboard, and Word-style real lists (rather than "- item" text) were not tested.

Issues found and fixed in Phase 3:
- **Dropped keystrokes (real usability bug).** The first E2E run showed text such as "ig title" and "ullet one": the first characters typed right after clicking a toolbar button were lost, because the click moved focus out of the editor and Tiptap restores it asynchronously. Fixed by preventing focus loss on toolbar mouse-down (`RichTextEditor.tsx`); the formatting E2E tests assert exact text and now pass.
- Two weak tests found by mutation checks (above) were strengthened.
- `client/src/content.ts` (the Phase 2 plain-text bridge) and its 4 tests were deleted because the Tiptap editor replaces it. The plain-text/paragraph conversion for `.txt` import is a Phase 4 concern and will be written and tested there.

Not verified: behaviour in browsers other than Chromium and installed Chrome; keyboard-only and screen-reader use of the toolbar beyond the `aria-pressed` and `aria-label` attributes tested; copy/paste from Word or web pages beyond the HTML-sanitisation unit test; very large documents (limits are enforced and unit-tested, but not load-tested).

## Phase 2 verification (commands actually run, 2026-10-25 15:10 PDT (UTC-07:00))

| Command | Result |
|---|---|
| `npm run verify` (typecheck, lint, test, build) | Exit 0. Vitest: 10 files, 94 tests passed, 0 failed, 0 skipped (server 69, client 25). Build succeeded |
| `npm run test:e2e` (Chromium) | 6 passed, 0 failed (5 document tests + 1 smoke) |
| `PW_CHANNEL=chrome npx playwright test --headed` | 6 passed, 0 failed |
| Mutation check: temporarily made `policy.can()` always return true, ran `npm run test:server` | 3 tests failed as expected (66 passed); the change was reverted. This shows the access-control tests can fail. Final state was re-verified by `npm run verify` above |
| `npm audit` | 0 vulnerabilities |

Per-file Vitest counts: server `database` 8, `app` 5, `seed` 2, `documents.service` 38, `documents.api` 16; client `BackendStatus` 3, `App` 3, `content` 4, `DocumentList` 7, `DocumentEditor` 8.

Notes and issues found:
- The first E2E run could not start because port 5173 was already used by a dev server running on this machine. E2E now uses dedicated ports (5273/3101), so it no longer collides with `npm run dev`.
- Restart persistence is verified by an integration test that closes and reopens a file database and rebuilds the app, plus a browser reload in E2E. I did not manually stop and restart `npm run dev`; `Testing-guide.md` lists the manual steps.
- The Phase 1 client test file `App.test.tsx` was split: the three health-status tests (P1-UI-1..3) moved with the same assertions to `BackendStatus.test.tsx`, because the status display became its own component. `App.test.tsx` now tests routing.

## Completed

- **After Phase 5 (owner request):** autosave, simultaneous-edit merging (Yjs), sync endpoint, collaboration tests, and the visual design.
- **Phase 5:** signed-cookie simulated sign-in with user switcher, migration 002, share and revoke (owner only), editor access, owned versus shared lists, policy tests, session tests, sharing service, API, component and two-user browser tests.
- **Phase 4:** `.txt` and `.md` import (raw-body upload endpoint, strict validation, text and Markdown converters, titles from file names), Import button with client pre-checks and supported types shown in the UI and README, error handling for unsupported, empty, binary, non-UTF-8, oversized and over-complex files, unit, API, component and browser tests.
- **Phase 3:** Tiptap editor with a formatting toolbar (bold, italic, underline, H1-H3, bulleted and numbered lists); narrowed editor schema; allowlist content validation on the server; editor/validator contract tests; formatting E2E tests.
- **Phase 2:** migration 001 (`users`, `documents`), seeded users, document service with owner-only policy and validation, REST routes, plain-text editor UI with explicit Save, list with create/delete, structured errors.
- **Phase 1:** React + TypeScript + Vite frontend shell; Fastify backend with `/api/health`; SQLite via `node:sqlite` with a migration runner; Vitest (server + jsdom client) and Playwright configured; typecheck/lint/build scripts; git initialized (no commits yet); the six required docs plus README.

## Outstanding

- Storage-failure injection and remaining error tests (Phase 6), two-user E2E (Phase 7), final docs and acceptance run (Phase 8).

## Known limitations

- Import: `.txt` and `.md` only, UTF-8 only, 512 KB maximum, creates a new document (no import into an existing one). Markdown links, images, code, quotes, tables and strike-through lose their formatting (text kept). `.docx` is deferred.
- Formatting is limited to the required set; no links, images, tables, alignment, fonts, colours, undo UI buttons (Ctrl+Z works), or strike-through.
- Sign-in is simulated: anyone who can open the app can choose any seeded user (no passwords), sessions never expire, no `Secure` flag, no CSRF token (SameSite=Lax only). Never production authentication.
- Live editing is by polling (about 2 s), has no live cursors or presence, and the shared edit history grows without compaction. A removed editor finds out on their next sync (within about 2 s).
- Only one share role (editor) exists; there is no read-only role, no sharing by email, no link sharing, and no way to transfer ownership.
- A non-owner gets 403 rather than 404 for an existing document, which reveals that the id exists.
- No autosave and no unsaved-changes warning when navigating away (Save is explicit).
- `node:sqlite` requires Node >= 22.13.
- The production build is not served by the backend.
- `esbuild` install script is blocked by npm policy; nothing observed to depend on it.

## Next steps

Remaining work, in the order I would do it (about 4-6 hours in total, my estimate): (1) database-failure injection tests and an error-handling review across routes (2-3 hours); (2) one continuous two-user end-to-end test and a usability pass (1-2 hours); (3) the AI workflow note the brief asks for (under 1 hour); (4) find the cause of the one intermittent browser failure; (5) serve the built frontend from the backend and add the cookie `Secure` flag for deployment (about 1 hour, see `deployment_guide.md`).
