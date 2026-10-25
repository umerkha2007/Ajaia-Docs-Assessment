# Submission: Ajaia Docs (Full Stack Product Engineer assessment)

Candidate: Umer Khalid (umerkha2007@gmail.com)

A lightweight, Google-Docs-style collaborative document editor: create, rename and edit rich-text documents, import `.txt` / `.md` files, share documents between seeded users, and edit together with automatic saving and merging.

## Links

| Item | Link |
|---|---|
| Source code (GitHub) | https://github.com/umerkha2007/Ajaia-Docs-Assessment |
| Live product URL | **NOT PROVIDED YET.** See "Before you submit" below |
| Walkthrough video | **NOT PROVIDED YET** |
| Google Drive folder | **NOT PROVIDED YET** |

## Before you submit (items the brief requires that are still missing)

These are honest gaps, not oversights in the app. Fill them in or the submission is incomplete.

| Required by the brief | State | What to do |
|---|---|---|
| A working deployment reviewers can access | **Not deployed.** `deployment_guide.md` explains how (frontend on Vercel, backend on a Node host; the backend cannot run on Vercel). The guide is **untested** | Deploy, run the checks at the end of `deployment_guide.md`, then put the URL above. Note: on Render's free plan all data is erased on every restart, so say so here |
| AI-Native Workflow Note (separate file, Markdown or PDF) | **Done:** `AIWorkflow.md` (converted from your Word document; 14 screenshots in `AIWorkflow_images/`). **Needs your attention:** it says you chose Supabase Postgres, but the app uses SQLite (see the warning below) | Fix that mismatch, and consider adding the four answers the brief asks for (tools used, where AI sped you up, what you changed or rejected, how you verified); a draft is in the last section of this file |
| Walkthrough video (3-5 minutes) and a text file with its URL | **Not recorded** | Record, then add the URL above and a `video_url.txt` |
| Google Drive folder with everything | **Not created** | Upload the files listed in "What is included" |
| Screenshots or a demo GIF if setup needs extra steps | Setup needs no extra steps beyond `npm install`; design screenshots exist in `UI/` | Optional |

> **Warning, please read before submitting.** `AIWorkflow.md` (Step 4) says you decided to go with "React in TS + Tiptap + Supabase Postgres". The submitted app does **not** use Supabase: it uses React + Vite, a Node/Fastify backend, and SQLite (`Architecture.md`), because the stack was changed when implementation was approved. A reviewer will see the contradiction. Either add a sentence to Step 4 explaining the change (for example: "after comparing options I chose Fastify + SQLite so the app runs with no external account"), or correct the step. I did not alter your wording. Also note: the diary has no section on deployment (the live URL is still missing) and its Step 5 plan lists Phase 7 as "Fix failures and deploy".

## What is included (exactly)

All of this is in the GitHub repository (the folder is the repository root).

| Path | What it is |
|---|---|
| `client/` | The React + TypeScript + Vite frontend (editor, document list, sharing panel, sign-in) |
| `server/` | The Node + TypeScript + Fastify backend (API, SQLite access, permissions, import, live-editing sync) |
| `shared/editorExtensions.ts` | The editor schema used by both the browser and the server |
| `e2e/` | Playwright browser tests (51 tests) |
| `README.md` | Overview and links (required deliverable) |
| `AIWorkflow.md`, `AIWorkflow_images/` | Your AI workflow note ("Assessment Diary") converted from the Word file, with its 14 screenshots (required deliverable). The original `Workflow for Ajaia.docx` is also in the folder |
| `Local-setup.md` | Local setup and run instructions, seeded accounts, troubleshooting (required deliverable; `README.md` links to it) |
| `Architecture.md` | Architecture note: stack, data model, permissions, live editing, import, error handling, limits (required deliverable; it is longer than "short") |
| `Testing-guide.md` | Test commands, requirement-to-test table, manual verification steps |
| `Roadmap.md` | What was verified, what was not, known defects, remaining work with estimates |
| `Plan.md`, `Agents.md`, `Requirements.md` | The plan, working rules and original brief used to run the project |
| `Changelog.md` | Every file changed, with timestamps and reasons |
| `deployment_guide.md` | How to deploy (untested) |
| `SUBMISSION.md` | This file |
| `UI/` | Design mockups (HTML exports and PNGs) that the interface follows. Reference only, not part of the build |
| `LLM_understanding.md` | An early planning assessment from before the stack was chosen. **Outdated** (it proposed SvelteKit); a note at the top says so. Safe to leave out |
| `package.json`, `package-lock.json`, `tsconfig*.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `eslint.config.js` | Configuration |

**Not included:** a video URL file, a deployment URL, a demo GIF.

## Run it locally (about 5 minutes)

Requirements: Node.js 22.13 or newer (developed and tested on 26.8.2, Windows 11), npm. No database server, accounts or paid services.

```powershell
git clone https://github.com/umerkha2007/Ajaia-Docs-Assessment.git
cd Ajaia-Docs-Assessment
npm install
npm run dev
```

Open http://127.0.0.1:5173. The backend runs on port 3001 and creates its SQLite database (`data/app.db`) and the seeded users automatically.

To run the tests:

```powershell
npm run verify                      # typecheck, lint, 490 unit/component/integration tests, production build
npx playwright install chromium     # one-time browser download (needs network)
npm run test:e2e                    # 51 browser tests; uses its own ports and a temporary database
```

More detail and troubleshooting: `Local-setup.md`.

## Test accounts (simulated sign-in)

There are no passwords. The first screen is "Choose a user"; click one.

| User | Email shown |
|---|---|
| Alice Anderson | alice@example.test |
| Bob Brown | bob@example.test |
| Carol Clark | carol@example.test |

Sign-in is **simulated** for the demo (the server remembers your choice in a signed cookie). It is not real authentication and the app says so on screen.

## How to review the main flows (5 minutes)

1. **Create and format:** sign in as Alice, click **New document**, rename it, type, use the toolbar (bold, italic, underline, H1-H3, bulleted and numbered lists). It saves by itself ("All changes saved"). Refresh: it is still there.
2. **Import:** click **Import file** and choose a `.md` or `.txt` file (limit: UTF-8, 512 KB; supported types are stated on the page). Try a `.pdf` or an empty file to see the error messages.
3. **Share:** open a document, use **Sharing** to share it with Bob. Switch user (header menu) to Bob: it appears under **Shared with you** with its owner and "Can edit". Bob cannot delete it or manage sharing.
4. **Revoke:** as Alice, **Remove** Bob. As Bob, the document disappears from his list and opening it shows a permission error.
5. **Access control:** sign in as Carol: she sees none of it, and its link shows a permission error.
6. **Live editing:** open the same shared document as Alice in one window and as Bob in a private window. Type in both at the same time, even in the same paragraph: after a couple of seconds both windows contain both edits, with no refresh and no Save click.

## What works end to end

| Brief requirement | Status | Notes |
|---|---|---|
| Create, rename, edit in a browser, save and reopen | Working, tested | Autosave plus a Save button |
| Bold, italic, underline, headings (levels 1-3), bulleted and numbered lists | Working, tested | Also survives pasting from other apps (links, tables, images are dropped, text kept) |
| File upload turning into an editable document | Working, tested | `.txt` and `.md` only; limit stated in the UI and `README.md`. `.docx` is **not** supported |
| Sharing: owner, grant access, owned vs shared distinction | Working, tested | Owner grants and revokes an "editor" role; separate "Your documents" and "Shared with you" sections |
| Persistence of documents, formatting and sharing | Working, tested | SQLite file; tested by closing and reopening the database and by reloading the browser |
| Basic validation and error handling | Working, tested | Titles, ids, uploads, content structure, permissions; clear messages; failed saves keep your text and retry |
| At least one meaningful automated test | 490 unit/component/integration tests and 51 browser tests | Results below |
| Clear setup and run instructions | Done | `Local-setup.md`, and this file |
| Architecture note | Done | `Architecture.md` |
| Live deployment | **Not done** | See above |
| AI workflow note | Done (`AIWorkflow.md`), see the warning above | |
| Walkthrough video | **Not done** | See above |

**Stretch beyond the brief:** simultaneous editing with character-level merging (Yjs, synced over HTTP every ~2 seconds), signed-cookie simulated sign-in with a user switcher, and a visual design based on the supplied mockups.

## Test results (commands actually run on 2026-10-25)

| Command | Result |
|---|---|
| `npm run typecheck`, `npm run lint`, `npm run build` | No errors |
| `npm test` | 490 passed, 0 failed, 0 skipped (server 352, client 138) |
| `npm run test:e2e` (Chromium) | 51 passed on each of three consecutive runs |
| Same suite, headed Google Chrome | 51 passed |
| `npm audit` | 0 vulnerabilities |

Be aware: one earlier browser-suite run in the same session reported 50 passed and 1 failed. I did not capture which test, could not reproduce it in the next three runs, and have not found the cause. The browser suite may be occasionally flaky.

I also checked that the tests can fail: I deliberately broke the permission, sharing, import and live-editing code in more than 20 ways and confirmed tests failed for each, except two. This found two weak tests (which I then rewrote) and one untested edge case (an empty shared document, now covered). The other undetectable change is an equivalent one (the only share role can both read and write, so no test can tell the two checks apart). Details in `Roadmap.md`.

## What I prioritized, and why

- **Server-side permissions over UI polish.** Every document request goes through one policy function, reads the user's access fresh from the database each time, and never trusts the client for ownership or role. Revocation therefore takes effect on the person's next request, including for someone already editing.
- **A canonical content format.** Documents are stored as the editor's JSON, not HTML. The server checks stored content against an allowlist (only the nodes and marks the editor can produce), so scripts, links and arbitrary attributes cannot be stored. Imported Markdown is converted through the same schema, and markup in files is kept as plain text.
- **Fixing last-save-wins.** Testing showed that two people editing at once overwrote each other. I replaced "save the whole document" with a merge based on individual edits (Yjs), validated again on the server, rather than adding a conflict warning.
- **Zero-cost, offline-friendly stack.** SQLite through Node's built-in `node:sqlite` (no native build, no service), no web fonts downloaded, no external calls at run time.
- **Tests before and beside each feature,** grouped by feature, with a requirement-to-test table in `Testing-guide.md`.

## What I intentionally did not do

- Real authentication (passwords, email), as the brief allows seeded accounts.
- `.docx` import, attachments, importing into an existing document, export.
- A read-only role, link sharing, sharing by email, ownership transfer.
- Live cursors or presence indicators; instant push (it polls every ~2 seconds).
- Comments, suggestions, version history.
- Mockup features that the product does not have: search, outline sidebar, drag-and-drop import dialog with progress, undo toast.
- Phases 6 and 7 of my own plan (a dedicated error-handling pass with database-failure tests, and a dedicated end-to-end usability pass) were skipped because of the time limit. Most of what they listed is covered by tests from other phases; the table in `Roadmap.md` says exactly what is and is not.

## Known issues and incomplete items

- Not deployed; the deployment guide is untested.
- The backend does not serve the built frontend, so a one-service deployment needs a small code change. The session cookie has no `Secure` flag (needed for a production deployment).
- Free hosting such as Render's free plan erases the database on every restart (see `deployment_guide.md`).
- No tests for the server failing to write to the database (disk full, locked database).
- Live-editing history in the database grows without compaction; not load-tested.
- The interface was compared to the mockups by looking at screenshots, not pixel-compared; narrow and mobile layouts are untested.
- Tested only on Node 26.8.2 and Windows.
- An unexplained intermittent browser-test failure (above).

## What I would build next with 2-4 more hours

1. (30-60 min) Deploy: serve the built frontend from the backend, add the `Secure` cookie flag, deploy to one host with a persistent disk, and run the deployment checks.
2. (2-3 h) The skipped phases: database-failure injection tests and an error-handling review; one continuous two-user end-to-end test; find the cause of the one intermittent failure.
3. (1-2 h) A read-only "viewer" role (the permission table already has a place for it), and presence indicators showing who else is editing.
4. (1 h) `.docx` import.

## Supplementary: the four AI questions from the brief (draft facts; review)

Your `AIWorkflow.md` is a step-by-step diary. The brief also asks specifically for which tools you used, where AI sped you up, what you changed or rejected, and how you verified. If you want those answers in the note, the points below are facts about how this repository was built, taken from the work itself. Edit them so they say what you actually did and decided, then copy what you want into `AIWorkflow.md`.

- **Tool used:** Claude Code (running Claude Sonnet 5.5) inside VS Code, for planning, writing code, tests and documentation, and running the checks. A sample solution folder was supplied for understanding only; none of its code was reused, and its Supabase and Vercel-based stack was rejected because it needs an external service.
- **Process rules given to the AI:** `Agents.md` required tests alongside each feature, an assessment before implementation, phase-by-phase approval, no unverified claims, and a changelog. The AI proposed an assessment and plan first; stack and product decisions (React + Vite instead of the sample's stack, seeded users with a switcher, `.docx` deferred) were approved by you before any code was written.
- **Where AI sped things up:** scaffolding the project and test setup, the permission and validation logic with large test suites, the Markdown and text converters, the editor and sharing screens, and applying the supplied design.
- **What was changed after checking AI output:**
  - Deliberately breaking the code to see whether tests fail showed two tests that would not have caught the bug they were written for (for example a link test that failed anyway because of an unrelated attribute rule); they were rewritten. It also showed an untested edge case (an empty shared document), which now has tests.
  - A real usability bug was found by the browser tests: the first keystrokes after clicking a toolbar button were lost. The fix was to stop toolbar buttons taking focus.
  - Testing by hand found the last-save-wins data loss that the AI's earlier design had accepted as a documented limitation; it was replaced with merged editing.
  - Several of the AI's own changes broke things and were corrected (a script flag in the wrong position that broke `npm run dev`; escaped characters written as literal invisible characters; a test that selected text with the wrong shortcut).
  - Honest-reporting rules produced the "not verified" lists in `Roadmap.md`: the AI was required to say when something was unverified, such as the deployment guide.
- **How correctness was verified:** automated tests at four levels (unit, API, component, real-browser), mutation checks, real two- and three-browser editing tests, screenshots for the design, and a final run of typecheck, lint, tests and build. What was **not** verified is listed above.
- **Where to be careful:** the live-editing code was verified by tests and mutation checks but not load-tested, and the deployment guide has not been run.
