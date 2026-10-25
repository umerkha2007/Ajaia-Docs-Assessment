# Architecture

Status: describes what exists after **Phase 5**. Sections marked *(planned)* are designed but not implemented and are not claimed to work.

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React 19 + TypeScript + Vite 8 | `client/` |
| Rich-text editor | Tiptap 3 (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm`) on ProseMirror | `client/src/editor/` |
| Backend | Node.js (>=22.13; developed on 26.8.2) + TypeScript + Fastify 5 | `server/`, run with `tsx` |
| Database | SQLite via Node's built-in `node:sqlite` | No native build step, no extra dependency |
| Unit/integration tests | Vitest 5 (+ React Testing Library, jsdom for components) | |
| End-to-end tests | Playwright (Chromium, or installed Chrome via `PW_CHANNEL=chrome`) | |
| Lint / types | ESLint 10 + typescript-eslint, `tsc` strict | |

No paid services, accounts or runtime network calls. Only `npm install` and the one-time Playwright browser download need the network.

### SQLite driver decision

Verified on Node v26.8.2: `node:sqlite` opens in-memory and file databases, runs prepared statements, enforces foreign keys and persists across close/reopen (tests `P1-SQLITE-1..4`, `FR-4.1`). `better-sqlite3` was not needed, which avoids native-compilation risk on a non-LTS Node. Trade-off: `node:sqlite` is a newer API and requires Node >= 22.13.

## Layers and data flow

```
React UI  --fetch /api/*-->  Vite dev proxy  -->  routes/  -->  services/  -->  policy.ts
client/src                                         HTTP only    business rules   who may do what
                                                                    |
                                                          validation.ts  -->  SQLite (db/)
```

| Layer | Files | Responsibility |
|---|---|---|
| UI | `client/src/*.tsx` | Rendering and user interaction. Authorization is not decided here |
| API client | `client/src/api.ts` | Typed `fetch` wrapper; turns server errors and network failures into `ApiError` |
| HTTP | `server/src/app.ts`, `routes/documents.ts`, `routes/session.ts` | Routing, status codes, the single error handler. Thin: resolve the signed-in user, call the service |
| Auth | `server/src/auth.ts`, `routes/session.ts` | Simulated sign-in: signed session cookie, who is acting on a request |
| Services | `server/src/services/documents.ts` | Document business logic. Every function takes the actor id and calls the policy itself |
| Policy | `server/src/policy.ts` | The only place that decides `can(actor, document access, action)` |
| Validation | `server/src/validation.ts` | Titles, ids, content envelope |
| Persistence | `server/src/db/` | Connection, migrations, seed data |
| Import | `server/src/import/` (`file.ts`, `text.ts`, `markdown.ts`), `client/src/importRules.ts` | File validation and conversion of `.txt`/`.md` to document JSON; client pre-checks |
| Editor | `client/src/editor/extensions.ts`, `RichTextEditor.tsx` | The editor schema and the formatting toolbar |

Because the service performs the policy check, a route (or script, or test) cannot read or change a document without it. `buildApp({ db, now })` takes its database and clock as parameters so tests use isolated databases and deterministic timestamps.

In development Vite serves the client on `127.0.0.1:5173` and proxies `/api` to the backend on `127.0.0.1:3001`. `npm run build` produces static files in `dist/client`; serving that from the backend is not implemented.

## Data model (migration 001)

| Table | Columns |
|---|---|
| `users` | `id` (PK, text), `name`, `email` (unique) |
| `document_shares` | `document_id` (FK to `documents`, ON DELETE CASCADE), `user_id` (FK to `users`), `role` (CHECK in (`editor`)), `created_at`; primary key (`document_id`, `user_id`); index on `user_id` |
| `app_settings` | `key` (PK), `value`. Holds `session_secret`, the random key that signs session cookies |
| `documents` | `id` (PK, UUID v4), `owner_id` (NOT NULL, FK to `users`), `title`, `content` (JSON text), `created_at`, `updated_at` (ISO-8601 UTC) |

Index `idx_documents_owner_updated (owner_id, updated_at DESC)`. Migration 002 added `document_shares` and `app_settings`. Schema changes go through `db/migrations.ts` (append-only, each applied in a transaction, recorded in `schema_migrations`).

Seeded users (`db/seed.ts`, idempotent `INSERT OR IGNORE`, run at startup): `user-alice`, `user-bob`, `user-carol`.

## Documents and persistence

- **Canonical content representation:** the Tiptap/ProseMirror document JSON (`editor.getJSON()`), stored as JSON text in `documents.content`. It is not HTML. The editor loads it directly and the server validates it; there is no HTML conversion step, so no HTML is ever injected into the page.
- **Supported formatting (the editor schema):** paragraphs; headings level 1-3; bulleted lists; numbered lists (nesting allowed); bold, italic and underline marks. Everything else StarterKit offers (links, code, code blocks, quotes, horizontal rules, strike, hard breaks, trailing node) is switched off in `extensions.ts`.
- **Server-side content validation** (`server/src/validation.ts`) is an allowlist of the same schema: allowed node types and which may contain which, allowed marks (no attributes), heading `level` 1-3, `orderedList` `start`/`type`, no unknown properties on any node, maximum depth 30, maximum 20,000 nodes, maximum 1,000,000 bytes. Structure is checked before the size check so a hostile deeply nested payload is rejected before anything recursive touches it. Phase 4 imports must produce content that passes it.
- **Contract between editor and validator:** `client/src/__tests__/editorContract.test.ts` drives a real headless Tiptap editor with the toolbar's commands and asserts the output passes the server validator, and that stored JSON loads back unchanged. If someone enables a new extension without updating the validator (or the reverse), these tests fail.
- **Safe rendering:** the editor renders from the ProseMirror schema, not from HTML strings, so markup typed or pasted into a document is shown as text (or dropped if it maps to an unsupported node) and cannot execute.
- A new document starts with one empty paragraph.
- `updated_at` changes on rename and on content save. Listing is ordered by `updated_at DESC, created_at DESC, id`.
- The list endpoint returns summaries without content.
- Default database file `data/app.db` (override with `DB_PATH`), WAL mode. Tests use `:memory:` or temp directories; E2E uses a temp-directory file and its own ports (5273/3101).
- Save is explicit (button). The editor stays uncontrolled after mount and `getJSON()` is read at save time. If a save fails the typed content stays in the editor.
- Toolbar buttons prevent focus loss on mouse-down; otherwise the first keystrokes typed right after a click were dropped while focus was restored.

## HTTP API

All `/api/documents*` routes require the simulated user header. Errors are `{ "error": CODE, "message": text }`.

| Route | Result |
|---|---|
| `GET /api/health` | `{status, sqliteVersion}` |
| `GET /api/session` | `{user, users}`: the signed-in user (or `null`) and the seeded accounts for the switcher. Public by design |
| `POST /api/session` `{userId}` | Simulated sign-in: sets the signed cookie. 401 for an unknown user, 400 for a missing id |
| `DELETE /api/session` | Sign out (clears the cookie), 204 |
| `GET /api/documents` | `{documents, shared}`: documents the user **owns** (each with `shareCount`) and documents **shared with** the user (each with `ownerName` and `role`), each newest update first |
| `POST /api/documents` `{title?}` | 201 `{document}`. Owner is the acting user; `ownerId`/`owner_id` in the body is ignored |
| `GET /api/documents/:id` | `{document}` with content, `ownerName`, and `access` (`owner` or `editor`: the caller's relationship) |
| `PATCH /api/documents/:id` `{title}` | rename |
| `PUT /api/documents/:id/content` `{content}` | save content |
| `DELETE /api/documents/:id` | 204 |
| `GET /api/documents/:id/shares` | `{shares}`: who has access (name, email, role, when). Owner only |
| `POST /api/documents/:id/shares` `{userId}` | Grant editor access; returns `{shares}`. Owner only. A client-sent `role` or owner is ignored. Sharing again with the same user changes nothing. 400 for yourself or an unknown user |
| `DELETE /api/documents/:id/shares/:userId` | Revoke; returns `{shares}`. Owner only. 404 if that user has no access |
| `POST /api/documents/import?filename=<name>` | 201 `{document}`. The request body is the raw file bytes (`Content-Type: application/octet-stream`, at most 512 KB). Creates a new document owned by the acting user |

Error codes: `UNSUPPORTED_FILE` 415, `FILE_TOO_LARGE` 413 and `INVALID_FILE` 400 (import), `VALIDATION_ERROR` 400 (bad title, id, content, or body shape), `BAD_REQUEST` 400 (malformed JSON, from the framework), `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `INTERNAL_ERROR` 500 (generic message; details go to the server log only). A document that exists but is not yours returns 403, which reveals that the id exists; this was accepted for clearer UX in a simulated-user app.

## File import (`.txt`, `.md`)

- **Flow:** the browser sends the chosen file as the raw request body with the name in a query parameter (no multipart library). The server (`importFile` in `import/file.ts`, called by `documents.importFile`) validates, converts, runs the result through the same `validateContent` as every save, and creates the document in one INSERT. Nothing is created if any step fails.
- **Validation order:** file name present and at most 255 characters; extension is exactly `.txt` or `.md` (case-insensitive, so `a.md.exe` and `a.markdown` are refused); not empty; at most 512 KB; no NUL bytes (rejects binary and UTF-16); strict UTF-8 decoding (a leading byte-order mark is removed); contains text; the converted document passes the content schema (depth, node and size limits), otherwise the file is refused as too complex.
- **Title:** the file name without its extension and without any directory part, control characters removed, at most 200 characters, else "Imported document".
- **`.txt` conversion:** one paragraph per line, a run of blank lines becomes a single empty paragraph, leading and trailing blank lines are dropped, control characters other than tab are removed. Markup in a text file is kept as literal text.
- **`.md` conversion:** uses only `marked`'s lexer (tokens), never its HTML renderer. Supported: headings (levels above 3 become 3), bold, italic (including combined), bulleted and numbered lists with nesting and start numbers, paragraphs. Hard line breaks (two trailing spaces) start a new paragraph; soft breaks become a space. Task-list items keep their state as a `[x] ` or `[ ] ` text prefix. Everything else degrades to plain text: link text without the URL, image alt text, inline code and code blocks (one paragraph per line), strike-through, block quotes, table rows (cells joined by " | "), raw HTML kept as literal text, rules and link definitions dropped. The five basic HTML entities are decoded (`&amp; &lt; &gt; &quot; &#39;`).
- **Safety:** the output contains only schema nodes with text, so imported markup is inert; the editor renders from the schema, not from HTML. The server never trusts the file name or content type.
- **Not supported:** `.docx`, attachments, importing into an existing document, other encodings.

## Simulated authentication and authorization

**Simulated sign-in (`auth.ts`).** The app has no passwords. The user picks one of the seeded accounts and the server stores that choice in a cookie `session=<base64url(userId)>.<HMAC-SHA256 signature>` (`HttpOnly`, `SameSite=Lax`, `Path=/`). The signing secret is 32 random bytes created on first use and kept in `app_settings`, so sessions survive restarts (and deleting the database signs everyone out). Every request re-verifies the signature (constant-time comparison) and that the user still exists. Only the first `session` cookie counts; the old `x-user-id` header is gone and is ignored. A browser therefore cannot become another user by editing its cookie.

What this is **not**: there are no passwords, so anyone who can open the app can choose any seeded user (that is the demo). There is no cookie expiry or rotation, no `Secure` flag (the app runs over plain http on localhost), and no CSRF token (cross-site protection is `SameSite=Lax` plus the fact that state-changing calls use JSON or octet-stream bodies and `PUT`/`PATCH`/`DELETE`). It must not be used to protect real data.

**Ownership and sharing model.**
- Every document has exactly one owner (`documents.owner_id`, NOT NULL, set from the signed-in user, never from the request). Ownership cannot be transferred.
- The owner may grant another seeded user an `editor` share. `role` is constrained by the database (`CHECK`) and by the server, which always writes `editor`.
- Permission matrix (`policy.can`): the **owner** may read, write, delete and share; an **editor** may read and write (edit content, rename) but not delete or manage sharing; anyone else may do nothing. An unrecognised role grants nothing.
- The service reads the actor's share from the database on **every call**, so revocation takes effect on the very next request, including for a user who already has the document open (their next save is refused and their unsaved text stays in their editor).
- Deleting a document cascades to its shares. Sharing does not change `updated_at`.
- Non-owners with no access get 403 (not 404) for an existing document, which reveals that the id exists. This was accepted for clearer errors in a simulated-user app.
- Hiding controls in the UI (no Delete for shared documents, no Sharing panel for editors) is a convenience; each action is checked again by the server.

## Error handling

Expected failures are `AppError` (code, status, message). One Fastify error handler maps them; unexpected exceptions become a generic 500 and are logged. Corrupt stored content raises `INTERNAL_ERROR` rather than returning an empty document, so a bad row cannot be silently saved over. The client keeps unsaved text in the editor when a save fails.

## Planned, not implemented

failure-injection tests for persistence errors and the remaining error-handling review (Phase 6), a full two-user end-to-end review (Phase 7).

## Testing approach

See `Testing-guide.md`.
