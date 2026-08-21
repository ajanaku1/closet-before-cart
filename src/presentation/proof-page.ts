export type ProofDecision =
  | "LOADING"
  | "FAILED"
  | "MORE_EVIDENCE"
  | "STYLE_READY"
  | "GAP_FOUND"
  | "SANDBOX_COMPLETED";

export interface ProofQuoteView {
  readonly amountMinor: number;
  readonly currency: string;
  readonly itemName: string;
  readonly merchant: string;
  readonly source: "LIVE" | "PINNED_DEMO";
}

export interface ProofActionView {
  readonly href: string;
  readonly label: string;
}

export interface ProofPageModel {
  readonly caseId: string;
  readonly decision: ProofDecision;
  readonly finding: string;
  readonly occasion: string;
  readonly ownedItems: readonly string[];
  readonly missingItem?: string | undefined;
  readonly previewUrl?: string | undefined;
  readonly quote?: ProofQuoteView | undefined;
  readonly action?: ProofActionView | undefined;
}

export const demoGapProof: ProofPageModel = {
  caseId: "CASE-0142",
  decision: "GAP_FOUND",
  finding: "Formal shoes are the only proven gap. CBC asks for department, US shoe size, and maximum budget before searching for an option.",
  occasion: "Friday wedding · no black · one new item maximum",
  ownedItems: ["White formal shirt", "Navy trousers"],
  missingItem: "Formal footwear",
  previewUrl: "/preview-outfit.svg",
};

const htmlEntities: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const cbcPhone = "+13109269508";
const cbcPhoneDisplay = "+1 (310) 926-9508";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => htmlEntities[character] ?? character);
}

function safeHref(value: string): string {
  return /^(?:\/(?!\/)|#)[A-Za-z0-9_./#?=&%-]*$/.test(value) ? escapeHtml(value) : "#";
}

function statusLabel(decision: ProofDecision): string {
  const labels: Record<ProofDecision, string> = {
    LOADING: "Checking proof",
    FAILED: "Proof unavailable",
    MORE_EVIDENCE: "More evidence needed",
    STYLE_READY: "No purchase needed",
    GAP_FOUND: "Gap found · one item maximum",
    SANDBOX_COMPLETED: "Sandbox approval recorded",
  };
  return labels[decision];
}

function headline(decision: ProofDecision): string {
  if (decision === "GAP_FOUND") return "You need one thing. <em>Not a new wardrobe.</em>";
  if (decision === "STYLE_READY") return "Your closet is ready. <em>Stop here.</em>";
  if (decision === "MORE_EVIDENCE") return "One clearer photo. <em>No guessing.</em>";
  if (decision === "SANDBOX_COMPLETED") return "Permission recorded. <em>No order placed.</em>";
  if (decision === "FAILED") return "This proof cannot open. <em>Nothing was charged.</em>";
  return "Checking the proof. <em>Hold the cart.</em>";
}

function renderPreview(model: ProofPageModel): string {
  const canShowPreview = model.decision !== "LOADING" && model.decision !== "FAILED";
  if (!canShowPreview || model.previewUrl === undefined) {
    return `<div class="preview preview--status" aria-live="polite"><span class="wardrobe-loader" aria-hidden="true"></span><p>${escapeHtml(model.finding)}</p></div>`;
  }
  return `<figure class="preview"><img src="${safeHref(model.previewUrl)}" alt="Synthetic editorial outfit assembled from the owned wardrobe"><figcaption>Synthetic editorial preview · not a fit guarantee</figcaption></figure>`;
}

function renderOwnedItems(model: ProofPageModel): string {
  const owned = model.ownedItems
    .map((item) => `<li><span>Owned</span><strong>${escapeHtml(item)}</strong></li>`)
    .join("");
  const missing = model.missingItem === undefined
    ? ""
    : `<li class="owned-list__gap"><span>Missing</span><strong>${escapeHtml(model.missingItem)}</strong></li>`;
  return `<ul class="owned-list">${owned}${missing}</ul>`;
}

function renderAction(action: ProofActionView | undefined): string {
  if (action === undefined) return "";
  return `<a class="primary-action" href="${safeHref(action.href)}">${escapeHtml(action.label)}</a>`;
}

function formatAmount(quote: ProofQuoteView): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: quote.currency,
    }).format(quote.amountMinor / 100);
  } catch {
    return `${escapeHtml(quote.currency)} ${(quote.amountMinor / 100).toFixed(2)}`;
  }
}

function renderQuote(model: ProofPageModel): string {
  if (model.decision !== "GAP_FOUND" || model.quote === undefined) return "";
  const quote = model.quote;
  const source = quote.source === "LIVE" ? "Live merchant quote" : "Pinned demo quote · not live availability";
  return `<aside class="quote"><p class="eyebrow">Bounded next step</p><h2>${escapeHtml(quote.itemName)}</h2><p class="price">${formatAmount(quote)}</p><p>${escapeHtml(quote.merchant)} · ${source}</p>${renderAction(model.action)}</aside>`;
}

function renderReceipt(model: ProofPageModel): string {
  if (model.decision !== "SANDBOX_COMPLETED") return "";
  return `<aside class="receipt"><p class="eyebrow">Sandbox receipt</p><h2>Permission approved</h2><p>No merchant order was placed. Use the merchant handoff only after a separate authorized checkout.</p></aside>`;
}

function renderRecovery(model: ProofPageModel): string {
  if (model.decision !== "MORE_EVIDENCE" && model.decision !== "FAILED") return "";
  const role = model.decision === "FAILED" ? ' role="alert"' : "";
  return `<section class="recovery"${role}><p>${escapeHtml(model.finding)}</p>${renderAction(model.action)}</section>`;
}

function evidenceHeading(decision: ProofDecision): string {
  if (decision === "STYLE_READY") return "Every required category is already owned.";
  if (decision === "MORE_EVIDENCE") return "The wardrobe record is not complete enough to decide.";
  if (decision === "SANDBOX_COMPLETED") return "The approval stayed bound to the proven one-item gap.";
  return "The closet passed every rule except the named gap.";
}

function renderEvidence(model: ProofPageModel): string {
  if (model.decision === "LOADING" || model.decision === "FAILED") return renderRecovery(model);
  const supportingPanel = `${renderQuote(model)}${renderReceipt(model)}`;
  return `<div class="proof-grid"><article class="evidence"><p class="eyebrow">Owned evidence</p><h3>${evidenceHeading(model.decision)}</h3>${renderOwnedItems(model)}</article>${supportingPanel}</div>${renderRecovery(model)}`;
}

function renderHeader(): string {
  return `<div class="announcement"><p>Personal styling, with a spending boundary.</p><a href="tel:${cbcPhone}">Call CBC · ${cbcPhoneDisplay}</a></div>
<header class="site-header"><a class="logo-lockup" href="#top" aria-label="Closet Before Cart home"><img src="/logo.svg" alt=""><span>Closet Before Cart</span></a><nav aria-label="Primary navigation"><a href="#how-it-works">How it works</a><a href="#style-proof">Style proof</a><a href="#contact">Contact</a></nav><a class="header-action" href="sms:${cbcPhone}">Text your stylist</a></header>`;
}

function renderHero(): string {
  return `<section class="hero" id="top"><div class="hero__copy" data-reveal><p class="eyebrow">The anti-impulse shopping assistant</p><h1>Wear more.<br><em>Buy less.</em></h1><p class="lede">CBC starts with what you own, styles a complete look, and unlocks one purchase only when your closet cannot finish it.</p><div class="hero__actions"><a class="primary-action" href="sms:${cbcPhone}">Start with your closet <span aria-hidden="true">↗</span></a><a class="text-action" href="#how-it-works">See how it works</a></div><p class="hero__note"><span aria-hidden="true">✓</span> No account · no subscription · one proven gap maximum</p></div><figure class="hero-photo" data-reveal><img src="/images/editorial-look.jpg" alt="Man buttoning a crisp white shirt in front of a mirror" width="1800" height="1201"><figcaption><span>Friday, 7:30 PM</span><strong>The closet has the shirt.<br>We find only what is missing.</strong></figcaption></figure></section>`;
}

function renderProcess(): string {
  return `<section class="process section" id="how-it-works"><div class="section-heading" data-reveal><p class="eyebrow">How CBC works</p><h2>Your best store is the closet you already have.</h2></div><div class="process-layout"><figure class="process-photo" data-reveal><img src="/images/wardrobe.jpg" alt="Clothing arranged on a wardrobe rail" width="960" height="1438"><figcaption>Start here. Shop later.</figcaption></figure><ol class="steps"><li data-reveal><span>01</span><div><h3>Show us the occasion</h3><p>Text your brief and a few private wardrobe photos. Raw photos are deleted after analysis.</p></div></li><li data-reveal><span>02</span><div><h3>Get a styled look</h3><p>CBC builds with owned pieces first, then checks every constraint without guessing.</p></div></li><li data-reveal><span>03</span><div><h3>Unlock one missing piece</h3><p>Only a proven gap reaches the cart—and only after your size and maximum budget are confirmed.</p></div></li></ol></div></section>`;
}

function renderProofStory(model: ProofPageModel): string {
  return `<section class="proof-section section" id="style-proof"><div class="proof-heading" data-reveal><div><p class="eyebrow">Live style proof · ${escapeHtml(model.caseId)}</p><h2>${headline(model.decision)}</h2></div><p>${escapeHtml(model.finding)}</p></div><div class="proof-story" data-reveal><div class="proof-evidence"><p class="occasion">${escapeHtml(model.occasion)}</p>${renderEvidence(model)}</div>${renderPreview(model)}</div></section>`;
}

function renderOneItemEdit(model: ProofPageModel): string {
  const item = escapeHtml(model.missingItem ?? "The proven missing piece");
  return `<section class="edit section"><div class="edit-photo" data-reveal><img src="/images/formal-shoes.jpg" alt="Pair of polished black leather formal shoes" width="1200" height="800"><span class="edit-photo__badge">1 item maximum</span></div><div class="edit-copy" data-reveal><p class="eyebrow">The one-item edit</p><h2>${item}</h2><p>This is a category recommendation—not a fabricated product quote. Tell CBC your department, US shoe size, and budget to search one suitable option.</p><dl><div><dt>Status</dt><dd>Proven gap</dd></div><div><dt>Next step</dt><dd>Confirm size + budget</dd></div></dl><a class="primary-action" href="sms:${cbcPhone}">Text my details <span aria-hidden="true">↗</span></a></div></section>`;
}

function renderFooter(): string {
  return `<section class="contact-panel" id="contact" data-reveal><p class="eyebrow">Your closet is open</p><h2>Ready to find the look<br>you already own?</h2><a href="sms:${cbcPhone}">Text ${cbcPhoneDisplay} <span aria-hidden="true">↗</span></a></section><footer><div class="footer-brand"><img src="/logo.svg" alt=""><strong>Closet Before Cart</strong><p>Personal style without the unnecessary spend.</p></div><div><p class="footer-label">Contact CBC</p><a href="tel:${cbcPhone}">${cbcPhoneDisplay}</a><a href="sms:${cbcPhone}">Send a text</a><a href="https://x.com/curioswhispers">@curioswhispers</a></div><div><p class="footer-label">The fine print</p><span>Raw photos deleted after extraction and rendering.</span><span>Synthetic preview is not a fit guarantee.</span><span>Sandbox approval ≠ merchant order.</span></div><p class="credits">Photography: <a href="https://unsplash.com/photos/man-wearing-white-dress-shirt-6Hv2W9Q2Pw0">Lumin</a>, <a href="https://unsplash.com/photos/SLIorbhV9iE">Husien Bisky</a>, and <a href="https://commons.wikimedia.org/wiki/File:Wardrobe_(Unsplash).jpg">Alexandra Gorn</a>.</p></footer>`;
}

export function renderProofDocument(model: ProofPageModel): string {
  const title = `${statusLabel(model.decision)} · Closet Before Cart`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Closet Before Cart styles what you own and unlocks only one proven missing piece."><title>${escapeHtml(title)}</title><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/style.css"><script src="/script.js" defer></script></head>
<body><a class="skip-link" href="#main-content">Skip to main content</a>${renderHeader()}<main id="main-content">${renderHero()}<div class="value-strip" aria-label="CBC principles"><span>Closet first</span><i aria-hidden="true"></i><span>One proven gap</span><i aria-hidden="true"></i><span>Spend with permission</span></div>${renderProcess()}${renderProofStory(model)}${renderOneItemEdit(model)}</main>${renderFooter()}</body></html>`;
}
