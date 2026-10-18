# ACHA Photo Tools

Photo tools for ACHA teams, running in the browser:

- **Roster headshots**: crop and shrink headshots to ACHA's **1000 × 1500** JPEG, at most
  **2,000,000 bytes** each.
- **Sort game photos**: add a game's photos (a ZIP, a folder or the photos) and get a ZIP with one
  folder per player, matched by jersey number against the team's roster. Unclear numbers go to
  a quick review. **Pick your jersey** hides the other team, referees and fans in one go.
- **Player page backgrounds**: each player's best action shot, cropped to a **1080 × 440** header
  under 250 KB and named after them (`max-haims.jpg`).
- **Teams & rosters**: import from ACHA or a team website (Puck Press plugin), or type one in.

Photos stay on the visitor's device. People are found with MediaPipe, jersey numbers are read
with PP-OCRv6 (ONNX Runtime), and jerseys are compared with DINOv2. All of it runs in the browser
and costs nothing to run. Work is saved in the browser's IndexedDB, so a closed tab carries on
where it stopped.

**The one thing that costs money is admin-only.** That's AI help for jersey numbers the local
reader can't make out (OpenAI `gpt-4.1-mini`). An admin turns it on per job, and the browser then
sends a small crop (≤768 px) of just those players to this site's server. The server checks the
admin login and the spending caps on every call, and holds the OpenAI key. Nobody else's photos
ever reach the server.

## How it fits together

```
browser  ── everything: decoding, detection, number reading, review, ZIPs, IndexedDB
   │  same-origin only (CSP connect-src 'self')
   ▼
server/ (Express)  ── serves dist/, plus a small /api:
   /api/auth/*     shared-password admin login (signed HttpOnly cookie)
   /api/vision/*   admin only: OpenAI proxy (prompts live here), input checks, daily/monthly caps
   /api/roster/*   public: fetches ACHA / team-website rosters (browsers can't call them directly)
```

The site also works on a plain static host (just `dist/`). Headshots, sorting with the local
reader, and typed-in rosters keep working. Admin login, AI help and roster import show as
unavailable.

`docs/SPEC.md` has the original headshot design. The sorting logic is a port of the old Python
app (resolver, goalie rules, background filter, banner framing), tests included.

## Develop

Needs Node 20 or newer.

```sh
npm install
npm run dev:server   # the API on :8787 (copy .env.example to .env first, optional)
npm run dev          # copies MediaPipe/ONNX Runtime files, downloads models, starts Vite (proxies /api)
```

`npm run dev` downloads about 60 MB of models into `public/models/` on its first run. They're
pinned and SHA-256-checked by `scripts/fetch-models.mjs`, and cached in `node_modules/.cache`.

Add `?mockcv` before the `#` (`http://localhost:5173/?mockcv#/jobs/new`) to replace people and
numbers with the filename-driven mocks. `game1_27_v12.jpg` holds two players: #27, readable, and
#12, readable only by the AI. See `shared/mockConvention.ts`. With `VISION_PROVIDER=mock`, the
server answers AI calls the same way, for free.

## Test

```sh
npm test             # unit tests: resolver, rules, server auth/vision/rosters, pipeline (fake IndexedDB)
npm run fixtures     # synthetic test images and a demo game in test-fixtures/ (no real people)
npm run build
npm run e2e          # Playwright against the built site and the real Node server
```

The e2e tests check, among other things, three rules. A non-admin's job never calls
`/api/vision`. An admin's job calls it only for the numbers the mock reader couldn't read. And the
endpoint refuses a missing or forged cookie. `npm run e2e` uses Playwright's Chromium
(`npx playwright install chromium`); set `PW_CHANNEL=chrome` or `msedge` to use an installed
browser.

To measure the browser models on real, reviewed photos from the old Python app (this only reads
them, and nothing is copied):

```sh
npx tsx scripts/eval-ocr.ts <photo_ai.db> <storage dir>         # number reader vs EasyOCR
npx tsx scripts/eval-appearance.ts <photo_ai.db> <storage dir>  # Pick your jersey separation (AUC)
```

On 186 real players, at the same 0.85 threshold, the browser reader is right 26% of the time and
right when confident 67% of the time. EasyOCR managed 19% and 39%. "Pick your jersey" separates
our team from everyone else with an AUC of 0.97–0.98 on full games.

## Configure the server

Everything is optional. With nothing set, the site serves every free tool, and admin login and AI
help are off. See `.env.example`.

| Variable | What it does |
|---|---|
| `ADMIN_PASSWORD` | Turns on admin login. Without it nobody is admin. |
| `SESSION_SECRET` | 32+ random characters that sign the login cookie. Without it, admins are logged out on restart. |
| `OPENAI_API_KEY` | Turns on AI help for admins. |
| `OPENAI_DAILY_CAP_USD`, `OPENAI_MONTHLY_CAP_USD` | Spending caps, enforced on the server (default $3/day, $10/month). |
| `DATA_DIR` | Folder for the AI usage log (`usage-YYYY-MM.jsonl`), so the caps survive restarts. Put it outside the deploy folder. |
| `TRUST_PROXY` | `1` behind Hostinger's proxy, so login throttling sees real visitor IPs. |
| `COOKIE_SECURE` | `true` over HTTPS (the default when `NODE_ENV=production`). |
| `OPENAI_MODEL`, `OPENAI_INPUT_COST_PER_1M`, `OPENAI_OUTPUT_COST_PER_1M` | Model and prices used for the cost estimates (default `gpt-4.1-mini`, $0.40 / $1.60). |

Also set a monthly limit on the OpenAI project itself, as a second safety net.

## Deploy to Hostinger (Node.js Web App)

1. Push this project to GitHub.
2. In hPanel, add a **Node.js Web App** and connect the repository. Use framework
   **Express/Other** and Node 20 or newer. The build command is `npm run build`, which downloads
   the models, builds the site into `dist/` and the server into `server-dist/`. The start command
   is `npm start`. The server listens on `PORT`.
3. Add the environment variables above: at least `NODE_ENV=production`, `TRUST_PROXY=1`,
   `ADMIN_PASSWORD`, `SESSION_SECRET`, `DATA_DIR`, and `OPENAI_API_KEY` if you want AI help.
4. Attach a subdomain. Hostinger provides HTTPS. Every push to `main` redeploys.

After deploying, check three things. DevTools → Console: `crossOriginIsolated` is `true`, which
gives the number reader several threads. There are no CSP errors. And every request goes to your
own domain.

**Static-only fallback:** upload the contents of `dist/` to any web host. `index.html` carries the
same CSP as a `<meta>` tag, and `public/.htaccess` sets the `.wasm` type for Apache.

## Checks to do by hand

- A real game ZIP (your own, never committed), sorted as a visitor and again as an admin with AI
  help: the cost shows on Job details and in the admin page's spend.
- Real headshots: faces are found and the framing looks right.
- iPhone HEIC photos work in Chrome and in Safari; 30+ large photos on an iPhone without the tab
  crashing.
- A 500-photo game on a laptop: it can be paused, the tab closed and reopened, and it carries on.
