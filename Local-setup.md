# Local Setup

## Prerequisites

- Node.js **>= 22.13** (built-in `node:sqlite`). Developed and verified on Node 26.8.2 / npm 12.0.2, Windows 11.
- No database server, accounts or paid services.

## Install

```powershell
npm install
npx playwright install chromium   # only needed for end-to-end tests (one-time download)
```

`npm install` may print a notice that `esbuild`'s install script was blocked by npm's `allowScripts` policy. On this machine `tsx`, Vite and all tests still worked without approving it, so it was left blocked.

## Initialize the database

Nothing to do. The SQLite file `data/app.db` and its schema are created automatically when the backend starts. Delete `data/app.db*` to reset.

## Run

```powershell
npm run dev          # backend on http://127.0.0.1:3001 and frontend on http://127.0.0.1:5173
```

Open http://127.0.0.1:5173. The first screen asks you to **choose a user** (a simulated sign-in; see below). After that you land on "Your documents". Create, rename, edit with the formatting toolbar (bold, italic, underline, headings 1-3, bulleted and numbered lists), save, reopen and delete documents, or import a `.txt` or `.md` file (UTF-8, up to 512 KB) with **Import file**. The footer shows "Backend: ok (SQLite x.y.z)" when the frontend, backend and database are connected.

Individual pieces: `npm run dev:server`, `npm run dev:client`. `npm run build` produces static client files in `dist/client`.

Environment variables (all optional): `PORT` (3001), `HOST` (127.0.0.1), `DB_PATH` (data/app.db), `CLIENT_PORT` (Vite, 5173).

## Seeded accounts

Created automatically at startup (idempotent):

| Id | Name | Email |
|---|---|---|
| `user-alice` | Alice Anderson | alice@example.test |
| `user-bob` | Bob Brown | bob@example.test |
| `user-carol` | Carol Clark | carol@example.test |

There are no passwords. The app shows a **Choose a user** screen; pick a user and the server sets a signed, HttpOnly cookie. Use the **Switch user** menu in the header to become someone else, or **Sign out**. To see sharing work: sign in as Alice, create a document, share it with Bob, then switch to Bob and open it under **Shared with you**. This is simulated sign-in for a demo, not real authentication.

To call the API from a terminal, sign in first and keep the cookie:

```powershell
curl.exe -c jar.txt -H "content-type: application/json" -d "{\"userId\":\"user-bob\"}" http://127.0.0.1:3001/api/session
curl.exe -b jar.txt http://127.0.0.1:3001/api/documents
```

(The old `x-user-id` header no longer works. Deleting `data/app.db` resets all data and signs everyone out, because the cookie-signing key lives in the database.)

To put the app on the internet see `deployment_guide.md`. Short version: the backend cannot run on Vercel (it needs a long-running process and a persistent disk); the frontend can.

## Notes on the design folder and fonts

The `UI/` folder holds the design mockups (HTML exports and PNGs) that the interface follows. It is reference material only: it is not built, served or tested, and ESLint ignores it. The app does not download web fonts, so it works offline; machines without Inter or Newsreader show the system sans-serif and Georgia.

## Checks

```powershell
npm run typecheck && npm run lint && npm test && npm run build   # or: npm run verify
npm run test:e2e   # uses its own ports (5273/3101) and a temp database, so it can run while `npm run dev` is up
$env:PW_CHANNEL='chrome'; npx playwright test --headed   # visible, installed Google Chrome
```

## Troubleshooting

- **Port 3001 or 5173 already in use:** stop the other process, or set `PORT` (note the Vite proxy reads `PORT` too). Vite uses `strictPort`, so it fails instead of silently picking another port.
- **E2E times out waiting for the web server:** make sure nothing is already listening on 5273/3101, and that Vite is bound to `127.0.0.1` (configured in `vite.config.ts`).
- **E2E says the browser is missing:** run `npx playwright install chromium`.
- **`No such built-in module: node:sqlite`:** upgrade Node to 22.13 or newer.
