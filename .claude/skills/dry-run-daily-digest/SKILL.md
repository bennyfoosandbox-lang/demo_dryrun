---
name: dry-run-daily-digest
description: Run a recurring, time-sensitive web research digest on a configurable topic and publish it as a self-contained HTML page to a GitHub repository — one time-stamped file per run under a topic folder — while keeping a persistent knowledge base so the same story is never reported twice. Use this skill whenever the user wants a daily (or weekly) research briefing, a scheduled "digest," a topic tracked over time and written to their repo / GitHub Pages, or any recurring unattended task that should scan the web (native web search + Firecrawl), dedup against past runs, synthesize a top-5 with citations, and publish clean HTML with a runtime link-liveness check. Trigger it even when the user just says "keep a daily digest of X in my repo" or "research Y every morning and publish it," without naming the skill.
---

# Dry-Run Daily Digest → GitHub

A **topic-agnostic** skill for recurring research that ends in a **published HTML page** plus a **repo-stored knowledge base (KB)**. The topic is supplied by the invocation, never hardcoded here, so one skill can drive many scheduled digests, each with its own folder and KB file.

This skill is built to run **unattended in a cloud scheduled task / remote routine**. Do not stop to ask the user questions mid-run — make reasonable defaults and record any assumptions in the digest footer itself. The one exception is a completely missing TOPIC (see Inputs).

## Inputs (read from the invocation prompt)

- **TOPIC** (required): the subject, e.g. `AI Agents & Tooling`. It has no safe default — if it is missing entirely, ask once, then proceed.
- **CADENCE** (default `daily`): sets the freshness window. `daily` → last 24h, `weekly` → last 7d, or a custom interval.
- **REPO_DIR** (default: the current git repo root): the working copy this session runs in.
- **PUBLISH_BRANCH** (default: the repo's default branch, usually `main`): the branch that is committed and that the host (Vercel) auto-deploys on every push.
- **SOURCE_BUDGET** (default: **75 native web searches + 25 Firecrawl**): how many candidate items to gather from each engine. Firecrawl is a free-tier/metered connector — treat **25 as a hard ceiling, not a target**, and degrade gracefully to web-search-only when Firecrawl is unavailable or out of credits.

## Derived paths (compute once, up front)

Let `slug` = TOPIC lowercased, every run of non-alphanumerics collapsed to a single hyphen, trimmed (e.g. `AI Agents & Tooling` → `ai-agents-tooling`).

Let `datestamp` = today as `YYYY-MMM-DD` with a 3-letter month, e.g. `2026-Jul-23`. This is the requested `topic-yyyy-MMM-dd` convention.

- Digest file for this run: `REPO_DIR/{slug}/{slug}-{datestamp}.html`
- Per-topic index: `REPO_DIR/{slug}/index.html` — lists every digest for the topic, newest first.
- Root landing page: `REPO_DIR/index.html` — the site root; lists every topic and links into each topic's index.
- Knowledge base: `REPO_DIR/knowledge-base/{slug}.md` — Markdown with a YAML frontmatter dedup set. See **Knowledge base format**.
- Serverless link checker: `REPO_DIR/api/check.js` — the Vercel function that does the real HTTP status check. Bundled with this skill as `assets/api-check.js`; provision it once (see Step 6).
- Templates: in `assets/` inside this skill. Read and fill them; never hand-write the HTML shell or the link-checker JS.

## The run, end to end

### Step 1 — Load the knowledge base (the dedup memory)

Read `REPO_DIR/knowledge-base/{slug}.md`.

- **Missing** → this is the **first run** for TOPIC. Everything found is new; you create the file in Step 5.
- **Present** → parse the frontmatter `entries` list. Each entry carries a `fingerprint` (a short stable slug for the story, e.g. `openai-agent-builder-ga`), a `title`, `first_seen`, the `digest` filename it appeared in, and one or more `urls`. The set of all fingerprints + all urls is this run's **dedup set**, and it is the single input that keeps steps 2 and 4 from resurfacing old news.

### Step 2 — Gather fresh, time-sensitive candidates

Compute the freshness cutoff from CADENCE (daily → last 24h). Aim for **~100 candidate items** so the ranking in Step 4 is meaningful — do **not** stop at the first five you like.

- **Native web search (~75 candidates):** issue several time-scoped `WebSearch` queries aimed at *news* — announcements, launches, studies, funding, incidents, regulation — not evergreen "best tools" listicles. Add recency qualifiers and prefer the last 24h. Vary the angle (product, enterprise adoption, research, policy) so coverage is broad, not five paraphrases of one story.
- **Firecrawl (~25 candidates, hard ceiling):** prefer `firecrawl_search` with `tbs` scoped to the last day, and reserve `firecrawl_scrape` for the few leads whose full text you actually need. Firecrawl returns richer full-page content, so spend it on the most promising leads, not routine queries. **Detect availability at runtime:** if the Firecrawl tools are absent (common in a locked-down remote routine), or any call errors / reports no credits, silently fall back to native web search for the remainder and record `Firecrawl: unavailable` in the footer. Never fail the run over Firecrawl.

For each candidate, record **every** source that mentions it, not just the first — that corroboration count feeds ranking. Apply the freshness window at gather time (sort by newest, scope queries to the window), not only when filtering later.

If the primary window yields fewer than 5 dedup-passing items, widen in steps (24h → 48h → 72h → 7d, ceiling ~30d) until you reach 5 or hit the ceiling. Widening relaxes **recency**, never **novelty** — items must still pass dedup. A thin digest (fewer than 5) is a valid, honest outcome; padding with filler is worse. Note the true age of any widened item (e.g. "from earlier this week").

### Step 3 — Filter against the dedup set

For each candidate, derive a `fingerprint` and compare it against the KB:

- Fingerprint already logged, **or** a citation URL already in the KB → **discard as already-covered** — unless there is a *materially new development* (a figure changed, something rumored has now shipped). In that case keep it as an explicit update and say so in the write-up.
- Otherwise it is new and eligible.

Only new, in-window items move forward. This is the whole point of the KB: across months of runs the reader sees each story once.

### Step 4 — Synthesize the top 5

Rank the survivors by (a) relevance and impact to TOPIC and (b) how many independent sources corroborate them — neither factor alone dominates. Consolidate near-duplicate coverage into one item, but keep every contributing source in that item's citations.

For each of the top ~5, write a **3–5 sentence paragraph in your own words**: what happened, why it matters to TOPIC, the key numbers and context. Never quote source text at length. Give each item a short, punchy headline.

**Citations are mandatory** and go at the end of each item as real links to the actual article URLs — a bare publication name is not a citation. Every item needs at least one working link; an item with none is dropped. List **all** corroborating sources, each as its own link. Use `https://` URLs only (an `http://` link is blocked as mixed content on an HTTPS page and would wrongly show as unreachable). These links are exactly what the runtime liveness checker probes.

### Step 5 — Update the knowledge base

Write `REPO_DIR/knowledge-base/{slug}.md`:

- Update the frontmatter scalars (`last_run`, increment `run_count` and `digest_count`).
- Append one `entries` item per **newly published** story: `fingerprint`, `title`, `first_seen` (today), `digest` (this run's filename), and `urls` (all citations).
- Append a dated section to the human-readable body, one bullet per new item, linking to this digest.
- On the first run, create the file with the full frontmatter + body header first.

Be thorough here even if the digest itself was trimmed for readability — this file is next run's dedup memory, and a story omitted here will reappear tomorrow. See **Knowledge base format** for the exact shape.

### Step 6 — Render the HTML

Read `assets/digest-template.html` and fill its placeholders (the comment block at its top lists them all): title, topic, human date, generated-at timestamp, the run tally, the source/Firecrawl note, and the `{{ITEMS}}` block.

Render each item as **static HTML** (headline + paragraph + a citations line) so the content is fully readable even where JavaScript is stripped (e.g. GitHub's in-repo file viewer). The template's built-in JS only *enhances* citations with a best-effort liveness dot — it is never required to read the content. Each citation must use the exact `<a class="cite">` + `<span class="link-status" data-url="…">` markup the template documents, or the checker won't find it.

Write the filled HTML to `REPO_DIR/{slug}/{slug}-{datestamp}.html`. Then regenerate `REPO_DIR/{slug}/index.html` from the digest files in that folder (newest first) using `assets/index-template.html`, and regenerate the root `REPO_DIR/index.html` from `assets/root-index-template.html` so this topic (and any others) appears on the site root. See `references/publishing.md` for the index/root generation rules and card markup.

**Provision the serverless link checker (once):** if `REPO_DIR/api/check.js` does not exist, copy this skill's `assets/api-check.js` to it. This is the Vercel function the digest calls for real HTTP status. The digest works without it — the page falls back to a best-effort browser check — but with it deployed the status dots are exact. Include `api/check.js` in the commit the first time you create it.

### Step 7 — Publish to GitHub

Commit the new digest, the regenerated indexes, and the updated KB in one commit, then push to PUBLISH_BRANCH so Pages serves it:

```
git add "{slug}/" "knowledge-base/{slug}.md" index.html api/check.js
git commit -m "digest({slug}): {datestamp} — N new items"
git push origin {PUBLISH_BRANCH}
```

(`api/check.js` only changes on the run that first creates it; `git add` is a no-op otherwise.)

Retry a failed push up to 4 times with exponential backoff (2s, 4s, 8s, 16s) — **only** for network errors. If the working copy isn't on the publish branch, or a push is rejected for a non-network reason, stop and report rather than force-pushing. This skill only appends commits; it never rewrites history.

### Step 8 — Report

End with a one-line tally: `N new items published · M already-known items skipped · <deployment URL to this digest>`. If nothing was new, still publish a short "nothing new since last run" digest and say so — a silent run is indistinguishable from a broken one. If Firecrawl was skipped, note it here too.

## Knowledge base format

`knowledge-base/{slug}.md` is Markdown with a YAML frontmatter block. The frontmatter is the machine-readable dedup set; the body is a human-readable log.

```markdown
---
topic: "AI Agents & Tooling"
topic_slug: ai-agents-tooling
created: 2026-07-23
last_run: 2026-07-23
run_count: 1
digest_count: 1
entries:
  - fingerprint: openai-agent-builder-ga
    title: "OpenAI ships its agent builder to general availability"
    first_seen: 2026-07-23
    digest: ai-agents-tooling-2026-Jul-23.html
    urls:
      - https://example.com/openai-agents
      - https://example.com/coverage
---

# Knowledge Base — AI Agents & Tooling

Running log of everything already covered, newest first. Each bullet links the digest it appeared in.

## 2026-Jul-23 (baseline run)
- **OpenAI ships its agent builder to GA** — no-code workflow agents. [digest](../ai-agents-tooling/ai-agents-tooling-2026-Jul-23.html)
```

Keep fingerprints lowercase, hyphenated, and stable; reuse an existing one rather than minting a near-duplicate. That stability is what makes dedup reliable across months of runs.

## Publishing & hosting

This skill targets **Vercel**: static HTML plus one serverless function (`api/check.js`) that performs a real server-side HTTP status check, so the citation dots are exact rather than best-effort. See `references/publishing.md` for the one-time Vercel import, how the serverless checker works, and the index/root generation rules. Each digest is a self-contained HTML file with inline CSS/JS, so it also renders fine opened locally or in GitHub's file viewer — it just falls back to the best-effort browser check when the `/api/check` endpoint isn't reachable.

## What this skill deliberately does not do

- It does not scrape X/Twitter, TikTok, or Instagram — they block most crawlers, Firecrawl included. If that coverage matters, it needs a different, interactive tool.
- It does not claim a citation is verified dead or alive with certainty — the runtime check is **best-effort** (a browser can't read a cross-origin HTTP status; see the template). It flags dead domains and network failures and offers a manual re-check; it's an aid, not a guarantee.
- It does not pad to five items — a short, honest digest beats filler.
- It does not force-push or rewrite history; it only appends commits to the publish branch.
