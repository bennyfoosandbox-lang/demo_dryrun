# Publishing & hosting (Vercel)

Each digest is a **single self-contained HTML file** (inline CSS + JS, no build step, no dependencies), so any static host serves it as-is. This skill targets **Vercel** because Vercel also runs the one small serverless function that makes the citation checker report **real** HTTP status instead of a best-effort guess.

## Why Vercel here

| Capability | Static file only | Vercel (this skill) |
|---|---|---|
| Serves the HTML + runtime JS | Yes | Yes |
| Auto-deploy on `git push` | depends on host | Yes |
| **Server-side link check** (true 200 / 404 / dead, no CORS wall) | **No** | **Yes** via `api/check.js` |
| Cost | — | Free hobby tier |
| Extra account | — | Vercel account, one-time repo import |

The digest degrades gracefully: when `/api/check` is reachable (i.e. deployed on Vercel) the status dots show the real HTTP code; when it isn't (file opened locally, GitHub's file viewer, not yet deployed) the page falls back to a best-effort browser probe that only detects dead domains. Either way the written content is fully readable.

## The serverless checker — `api/check.js`

Bundled with this skill as `assets/api-check.js`. On the first run the skill copies it to `REPO_DIR/api/check.js` and commits it. Vercel auto-detects any file under `/api` as a function, so no config is needed. It:

- accepts `GET /api/check?url=<encoded https url>`,
- does a server-side `HEAD` (falling back to `GET` on 405/501) with a 10s timeout,
- returns `{ ok, status, finalUrl }` or `{ ok:false, status:0, error }`,
- sets an edge cache (`s-maxage=3600`) so repeated page loads don't re-hit every source.

Because it runs on the server it is **not** blocked by the browser's cross-origin rule, so a `404` reads as `404`, not "domain responded."

## One-time Vercel setup (the user does this later)

1. Create a Vercel account and **Add New → Project → Import** the `demo_dryrun` GitHub repo.
2. Framework preset: **Other** (it's static + an API function). Root directory: repo root. Deploy.
3. Every push to the connected branch (default `main`) auto-deploys. The site lives at `https://<project>.vercel.app/`.
4. Verify the checker: open `https://<project>.vercel.app/api/check?url=https://example.com` — it should return JSON like `{"ok":true,"status":200,...}`.

After that:
- Site root (topic list): `https://<project>.vercel.app/`
- A topic index: `https://<project>.vercel.app/<slug>/index.html`
- A specific digest: `https://<project>.vercel.app/<slug>/<slug>-YYYY-MMM-DD.html`

Notes:
- The repo can stay **private** with Vercel — unlike GitHub Pages, the free tier serves private repos.
- No `vercel.json` is required. Add one only if you later want custom routes or headers.

## Regenerating the topic index each run

After writing the new digest, rebuild `{slug}/index.html` from `assets/index-template.html`:
- List every `{slug}-*.html` file in the folder (exclude `index.html`), sort **newest first** by the date parsed from the filename.
- Emit one `<li>` per digest into `{{ROWS}}` — link text is the human date, plus a small item count if known.
- Fill `{{TOPIC}}` and `{{COUNT}}`.

## Regenerating the root landing page each run

Rebuild `REPO_DIR/index.html` from `assets/root-index-template.html` on every run so new topics appear:
- Scan top-level directories, skipping `.git`, `.claude`, `api`, `knowledge-base`. A directory is a topic if it contains an `index.html`.
- For each topic: title from `knowledge-base/{slug}.md` frontmatter (`topic:`), digest count = number of `{slug}-*.html` files, latest date parsed from the newest filename.
- Emit one card per topic into `{{CARDS}}`, most-recently-updated first:
  ```html
  <a class="topic" href="./{slug}/index.html">
    <h2>{topic title}</h2>
    <p class="meta">{N} digests · latest {DD Mon YYYY}</p>
  </a>
  ```

On Vercel the browser opens this root automatically, so `https://<project>.vercel.app/` shows the topic list and each card drills into `/{slug}/index.html`.
