export const runtime = "nodejs";

function escapeAttribute(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function approvalTarget(requestUrl) {
  const raw = new URL(requestUrl, "https://cbc.invalid").searchParams.get("target");
  if (!raw) return null;
  let target;
  try {
    target = new URL(raw);
  } catch {
    return null;
  }
  if (
    target.protocol !== "https:"
    || target.hostname !== "sandbox.collect.prava.space"
  ) {
    return null;
  }
  return target.href;
}

function render(response, status, body) {
  response.statusCode = status;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-robots-tag", "noindex, nofollow");
  response.setHeader(
    "content-security-policy",
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  );
  response.end(body);
}

export default function handler(request, response) {
  if (request.method !== "GET") {
    return render(response, 405, "<!doctype html><title>Method not allowed</title><p>Method not allowed.</p>");
  }
  const target = approvalTarget(request.url);
  if (target === null) {
    return render(response, 400, "<!doctype html><title>Invalid approval</title><p>This approval link is invalid.</p>");
  }
  const safeTarget = escapeAttribute(target);
  return render(response, 200, `<!doctype html>
<html lang="en"><meta name="viewport" content="width=device-width"><title>Open Prava approval</title>
<body style="font-family:system-ui;max-width:34rem;margin:4rem auto;padding:1.5rem;line-height:1.5">
<main><h1>Ready to approve</h1><p>This extra step prevents Messages from previewing and consuming your one-time Prava session.</p>
<p><a href="${safeTarget}" rel="noreferrer" style="display:inline-block;padding:1rem 1.25rem;background:#123c34;color:white;border-radius:.75rem;text-decoration:none;font-weight:700">Open Prava approval</a></p>
<p>Use this button once. No merchant order is placed by this sandbox approval.</p></main></body></html>`);
}
