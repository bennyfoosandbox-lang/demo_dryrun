// Vercel serverless function — real server-side link liveness check.
// Deployed at /api/check ; the digest page calls /api/check?url=<encoded>.
// Runs server-side, so it is NOT subject to the browser's cross-origin wall and
// can return the true HTTP status (200 / 404 / 500 / dead).
//
// Copied verbatim by the dry-run-daily-digest skill to REPO_DIR/api/check.js on
// the first run. No dependencies; uses the platform's global fetch.

export default async function handler(req, res) {
  const url = (req.query && req.query.url) || "";
  if (!/^https?:\/\//i.test(url)) {
    res.status(400).json({ ok: false, status: 0, error: "missing or invalid url" });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  async function probe(method) {
    return fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "dry-run-daily-digest link-checker" },
    });
  }

  try {
    // Prefer HEAD (cheap); some servers reject it, so retry with GET on 405/501.
    let r = await probe("HEAD");
    if (r.status === 405 || r.status === 501) r = await probe("GET");
    clearTimeout(timer);
    // Cache at the edge for an hour so repeated loads don't re-hit every source.
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    res.status(200).json({ ok: r.ok, status: r.status, finalUrl: r.url || url });
  } catch (e) {
    clearTimeout(timer);
    const aborted = e && e.name === "AbortError";
    res.status(200).json({
      ok: false,
      status: 0,
      error: aborted ? "timeout" : "unreachable",
    });
  }
}
