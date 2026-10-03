# ACHA Headshots

Crop and shrink roster headshots for ACHA, entirely in the browser. Add photos or a ZIP, check the
automatic crops, and download a ZIP where every photo is exactly **1000 × 1500** JPEG and at most
**2,000,000 bytes**.

There is no backend, no upload and no account. Face finding (MediaPipe), cropping and compression
all run on the visitor's device, and a Content Security Policy in `index.html` stops the page from
sending anything to another site. Work in progress is saved in the browser's IndexedDB, so a
refresh doesn't lose it.

The full design is in [docs/SPEC.md](docs/SPEC.md).

## Develop

Needs Node 20 or newer.

```sh
npm install
npm run dev        # copies MediaPipe's WASM into public/, then starts Vite
```

Add `?debug` to the page URL to see the raw face (yellow) and person (cyan) boxes in the crop
editor, plus the estimated top of each head (dashed red). Use it to tune the framing constants at
the top of `src/lib/crop.ts`.

## Test

```sh
npm test                     # unit tests (framing, names, edit rules, size loop)
npm run fixtures             # synthetic test images in test-fixtures/ (no real people)
npm run build
npm run e2e                  # Playwright against the production build
```

`npm run e2e` uses Playwright's own Chromium (`npx playwright install chromium`). To use a
browser that's already installed instead, set `PW_CHANNEL=chrome` (or `msedge`). Set
`PW_WEBKIT=1` to also run in WebKit.

## Deploy to Hostinger (Business plan "Web App")

The site is static: `npm run build` writes everything to `dist/`. `public/.htaccess` (copied into
`dist/`) makes the server send `.wasm` files as `application/wasm`. hPanel labels may differ slightly.

1. Push this project to a GitHub repository.
2. In hPanel, add a **Web App**, connect GitHub and choose the repository. Use framework **Vite**,
   build command `npm run build`, output directory `dist`, Node 20 or newer.
3. Attach a subdomain, for example `headshots.yourdomain.com`. Hostinger provides HTTPS.
4. Every push to the `main` branch redeploys.

**Fallback:** run `npm run build` locally and upload the contents of `dist/` with File Manager to
the subdomain's folder. The build uses relative paths, so it works in any folder.

After deploying, open the site, then DevTools → Network: `.wasm` files should be served as
`application/wasm`, and every request should go to your own domain.

## Checks to do by hand

- Real headshots (your own, never committed): faces are found and the framing looks right.
- A group photo is flagged "more than one person", and clicking the other face re-frames.
- iPhone HEIC photos work in Chrome and in Safari.
- 30+ large photos on an iPhone without the tab crashing.
- Offline: after the first load, turn on airplane mode. Processing and download still work.
  (The HEIC and TIFF decoders load the first time they're needed, so add one of those while
  online first if you want to test them offline.)
