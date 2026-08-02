import { createHash } from "node:crypto";
import type { CommerceQuote, StyleProof } from "../contracts/domain.js";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface PravaGatewayOptions {
  readonly secretKey: string;
  readonly userEmail: string;
  readonly callbackUrl: string;
  readonly merchantUrl: string;
  readonly fetch?: Fetcher;
}

export interface PravaFailure {
  readonly code: string;
  readonly message: string;
}

export interface PravaPaymentResult {
  readonly status: "APPROVED" | "DECLINED" | "PENDING";
  readonly error?: PravaFailure;
}

export class PravaGatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PravaGatewayError";
  }
}

const blockedTlds = new Set([
  "demo",
  "devices",
  "example",
  "internal",
  "invalid",
  "local",
  "localhost",
  "test",
]);

const supportedTlds = new Set([
  "ai", "app", "co", "com", "dev", "io", "net", "ng", "org", "shop", "space", "store", "uk", "us",
]);

function hasSupportedDomain(domain: string): boolean {
  const labels = domain.toLowerCase().split(".");
  const tld = labels.at(-1) ?? "";
  return labels.length >= 2
    && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    && !blockedTlds.has(tld)
    && supportedTlds.has(tld);
}

function customerEmail(value: string): string {
  const email = value.trim();
  const match = /^([^\s@]+)@([^\s@]+)$/.exec(email);
  if (!match?.[1] || !match[2] || !hasSupportedDomain(match[2])) {
    throw new Error("Prava customer email must use a routable supported domain");
  }
  return email;
}

function merchantOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Prava merchant URL must be a bare HTTPS origin");
  }
  if (
    url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || url.port !== ""
    || (url.pathname !== "" && url.pathname !== "/")
    || url.search !== ""
    || url.hash !== ""
    || !hasSupportedDomain(url.hostname)
  ) {
    throw new Error("Prava merchant URL must be a bare HTTPS origin on a supported domain");
  }
  return url.origin;
}

function decimalAmount(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error("Prava amount must be a positive integer");
  }
  return (amountMinor / 100).toFixed(2);
}

function customerId(senderId: string): string {
  const normalized = senderId.trim();
  if (!normalized) throw new Error("Prava customer sender id is required");
  const digest = createHash("sha256").update(`cbc-prava-v1:${normalized}`).digest("hex");
  return `cbc_${digest}`;
}

function session(value: unknown): { approvalId: string; approvalUrl: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Prava response must be an object");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.session_id !== "string" || typeof record.iframe_url !== "string") {
    throw new Error("Prava response is missing session details");
  }
  return { approvalId: record.session_id, approvalUrl: record.iframe_url };
}

function safeFailure(value: unknown, fallbackCode: string, fallbackMessage: string): PravaFailure {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { code: fallbackCode, message: fallbackMessage };
  }
  const error = (value as Record<string, unknown>).error;
  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    return { code: fallbackCode, message: fallbackMessage };
  }
  const record = error as Record<string, unknown>;
  const code = typeof record.code === "string" && /^[A-Z0-9_.-]{1,80}$/.test(record.code)
    ? record.code
    : fallbackCode;
  const message = typeof record.message === "string"
    ? record.message.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 240)
    : fallbackMessage;
  return { code, message: message || fallbackMessage };
}

async function responseFailure(
  response: Response,
  fallbackCode: string,
  fallbackMessage: string,
): Promise<PravaFailure> {
  try {
    return safeFailure(await response.json(), fallbackCode, fallbackMessage);
  } catch {
    return { code: fallbackCode, message: fallbackMessage };
  }
}

function paymentResult(value: unknown): PravaPaymentResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Prava payment result must be an object");
  }
  const status = (value as Record<string, unknown>).status;
  if (status === "pending") return { status: "PENDING" };
  if (status === "awaiting_result" || status === "completed") return { status: "APPROVED" };
  if (status === "failed") {
    return {
      status: "DECLINED",
      error: safeFailure(value, "PRAVA_PAYMENT_FAILED", "Prava declined the sandbox payment"),
    };
  }
  throw new Error("Prava payment result has an unknown status");
}

function matchesBoundQuote(proof: StyleProof, quote: CommerceQuote): boolean {
  return proof.quoteId === quote.quoteId
    && proof.merchant === quote.merchant
    && proof.variantId === quote.variantId
    && proof.amountMinor === quote.amountMinor
    && proof.currency === quote.currency;
}

interface PravaContext {
  readonly secretKey: string;
  readonly userEmail: string;
  readonly callbackUrl: string;
  readonly merchantUrl: string;
  readonly fetcher: Fetcher;
}

function sessionPayload(
  context: PravaContext,
  proof: StyleProof,
  quote: CommerceQuote,
  senderId: string,
): Record<string, unknown> {
  const amount = decimalAmount(quote.amountMinor);
  return {
    user_id: customerId(senderId),
    user_email: context.userEmail,
    total_amount: amount,
    currency: quote.currency,
    integration_type: "full_checkout",
    callback_url: context.callbackUrl,
    external_order_ref: proof.proofId,
    description: `CBC sandbox approval for ${quote.variantId}`,
    purchase_context: [{
      merchant_details: {
        name: quote.merchant,
        url: context.merchantUrl,
        country_code_iso2: "US",
      },
      product_details: [{
        description: proof.missingCategory ?? quote.variantId,
        product_id: quote.variantId,
        unit_price: amount,
        quantity: 1,
      }],
    }],
  };
}

async function requestPravaApproval(
  context: PravaContext,
  proof: StyleProof,
  quote: CommerceQuote,
  senderId: string,
): Promise<{ approvalId: string; approvalUrl: string }> {
  if (proof.decision !== "GAP_FOUND" || !quote.available) {
    throw new Error("Prava approval requires a purchasable gap proof");
  }
  if (!matchesBoundQuote(proof, quote)) {
    throw new Error("Prava approval requires a bound quote");
  }
  const response = await context.fetcher("https://sandbox.api.prava.space/v1/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${context.secretKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(sessionPayload(context, proof, quote, senderId)),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.ok) return session(await response.json());
  const failure = await responseFailure(
    response,
    "PRAVA_SESSION_CREATE_FAILED",
    `Prava session creation failed (${response.status})`,
  );
  throw new PravaGatewayError(failure.code, failure.message);
}

async function getPravaResult(
  context: PravaContext,
  approvalId: string,
): Promise<PravaPaymentResult> {
  if (!approvalId.trim()) throw new Error("Prava approval id is required");
  const url = `https://sandbox.api.prava.space/v1/sessions/${encodeURIComponent(approvalId)}/payment-result`;
  const response = await context.fetcher(url, {
    headers: { authorization: `Bearer ${context.secretKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.ok) return paymentResult(await response.json());
  const failure = await responseFailure(
    response,
    "PRAVA_PAYMENT_RESULT_FAILED",
    `Prava payment result failed (${response.status})`,
  );
  throw new PravaGatewayError(failure.code, failure.message);
}

export function createPravaGateway(options: PravaGatewayOptions) {
  if (!options.secretKey.startsWith("sk_test_")) {
    throw new Error("Prava sandbox requires a test key");
  }
  const context: PravaContext = {
    secretKey: options.secretKey,
    userEmail: customerEmail(options.userEmail),
    callbackUrl: options.callbackUrl,
    merchantUrl: merchantOrigin(options.merchantUrl),
    fetcher: options.fetch ?? fetch,
  };
  return {
    requestApproval(proof: StyleProof, quote: CommerceQuote, senderId: string) {
      return requestPravaApproval(context, proof, quote, senderId);
    },
    getResult(approvalId: string) {
      return getPravaResult(context, approvalId);
    },
  };
}
