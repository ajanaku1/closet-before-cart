import assert from "node:assert/strict";
import test from "node:test";

import {
  demoGapProof,
  renderProofDocument,
  type ProofPageModel,
} from "../../src/presentation/proof-page.ts";

test("the public demo asks for shopping details without showing a fabricated quote", () => {
  const html = renderProofDocument(demoGapProof);

  assert.equal(demoGapProof.quote, undefined);
  assert.match(html, /department, US shoe size, and maximum budget/i);
  assert.doesNotMatch(html, /Everlane/i);
  assert.doesNotMatch(html, /Pinned apparel|\$29\.00|Review permission/);
});

test("the public demo presents CBC as a photographic commerce experience", () => {
  const html = renderProofDocument(demoGapProof);

  assert.match(html, /<nav[^>]+aria-label="Primary navigation"/);
  assert.match(html, /href="#how-it-works"/);
  assert.match(html, /href="#style-proof"/);
  assert.match(html, /Start with your closet/);
  assert.match(html, /How CBC works/);
  assert.match(html, /The one-item edit/);
  assert.match(html, /\/images\/editorial-look\.jpg/);
  assert.match(html, /\/images\/formal-shoes\.jpg/);
  assert.match(html, /<script src="\/script\.js" defer><\/script>/);
});

test("the public demo exposes the supplied CBC phone number as call and text links", () => {
  const html = renderProofDocument(demoGapProof);

  assert.match(html, /\+1 \(310\) 926-9508/);
  assert.match(html, /href="tel:\+13109269508"/);
  assert.match(html, /href="sms:\+13109269508"/);
});

const baseModel: ProofPageModel = {
  caseId: "CASE-0142",
  decision: "GAP_FOUND",
  finding: "Formal shoes are the only proven gap.",
  occasion: "Friday wedding · no black · one new item maximum",
  ownedItems: ["White formal shirt", "Navy trousers"],
  missingItem: "Formal footwear",
  previewUrl: "/preview-outfit.svg",
  quote: {
    amountMinor: 2900,
    currency: "USD",
    itemName: "Leather Derby",
    merchant: "Pinned apparel demo",
    source: "PINNED_DEMO",
  },
  action: { href: "/approval/CASE-0142", label: "Review permission" },
};

test("GAP_FOUND puts owned evidence before one bounded quote", () => {
  const html = renderProofDocument(baseModel);

  assert.ok(html.indexOf("Owned evidence") < html.indexOf("Bounded next step"));
  assert.match(html, /White formal shirt/);
  assert.match(html, /Formal footwear/);
  assert.match(html, /Leather Derby/);
  assert.match(html, /\$29\.00/);
  assert.match(html, /Review permission/);
  assert.match(html, /Synthetic editorial preview · not a fit guarantee/);
  assert.match(html, /Raw photos deleted after extraction and rendering/);
  assert.match(html, /Sandbox approval ≠ merchant order/);
});

test("STYLE_READY never renders a quote or payment action", () => {
  const html = renderProofDocument({
    ...baseModel,
    decision: "STYLE_READY",
    finding: "Your closet already satisfies the brief.",
    missingItem: undefined,
    quote: undefined,
    action: undefined,
  });

  assert.match(html, /No purchase needed/);
  assert.doesNotMatch(html, /Bounded next step|Review permission|Leather Derby/);
});

test("MORE_EVIDENCE provides one clear recovery action", () => {
  const html = renderProofDocument({
    ...baseModel,
    decision: "MORE_EVIDENCE",
    finding: "We need a clearer photo of your shoes.",
    missingItem: undefined,
    quote: undefined,
    action: { href: "/reply", label: "Send one shoe photo" },
  });

  assert.match(html, /More evidence needed/);
  assert.match(html, /Send one shoe photo/);
  assert.doesNotMatch(html, /Bounded next step|Review permission|named gap/);
});

test("SANDBOX_COMPLETED is labelled as a receipt rather than an order", () => {
  const html = renderProofDocument({
    ...baseModel,
    decision: "SANDBOX_COMPLETED",
    finding: "Prava approved the exact sandbox amount.",
    action: undefined,
  });

  assert.match(html, /Sandbox receipt/);
  assert.match(html, /No merchant order was placed/);
  assert.doesNotMatch(html, /Review permission|Bounded next step/);
});

test("LOADING and FAILED announce status and preserve a recovery path", () => {
  const loading = renderProofDocument({
    ...baseModel,
    decision: "LOADING",
    finding: "Checking the signed proof.",
    ownedItems: [],
    missingItem: undefined,
    quote: undefined,
    action: undefined,
  });
  const failed = renderProofDocument({
    ...baseModel,
    decision: "FAILED",
    finding: "This proof link is unavailable or expired.",
    ownedItems: [],
    missingItem: undefined,
    quote: undefined,
    action: { href: "/", label: "Return to CBC" },
  });

  assert.match(loading, /aria-live="polite"/);
  assert.match(loading, /Checking the signed proof/);
  assert.match(failed, /role="alert"/);
  assert.match(failed, /Return to CBC/);
});

test("escapes untrusted case and provider copy", () => {
  const html = renderProofDocument({
    ...baseModel,
    caseId: '<script>alert("case")</script>',
    finding: '<img src=x onerror="alert(1)">',
    ownedItems: ["Shirt & trousers"],
  });

  assert.doesNotMatch(html, /<script>|<img src=x/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Shirt &amp; trousers/);
});
