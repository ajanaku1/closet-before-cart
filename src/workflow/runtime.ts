import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { PinnedCommerceAdapter } from "../adapters/pinned.js";
import { normalizeLinqEvent, type NormalizedLinqEvent } from "../adapters/linq.js";
import { createLinqGateway } from "../adapters/linq-gateway.js";
import { createOpenAIWardrobeAdapter } from "../adapters/openai.js";
import {
  createPravaGateway,
  PravaGatewayError,
  type PravaPaymentResult,
} from "../adapters/prava.js";
import { createCaseStore } from "../adapters/case-store.js";
import { createRuntimeProofCodec } from "../adapters/runtime-proof.js";
import { EphemeralMediaStore } from "../adapters/ephemeral-media.js";
import type { CommerceQuote, StyleProof } from "../contracts/domain.js";
import { runWardrobeCase } from "../domain/case-runner.js";
import { prepareWardrobeIntake } from "../domain/intake.js";
import { bindQuoteToProof } from "../domain/payment.js";
import type { GarmentCategory, StyleConstraints } from "../domain/style-gap.js";
import { processWardrobeMessage } from "./process-case.js";
import { processShoppingReply } from "./process-shopping.js";
import { runWithTyping } from "./typing.js";

type JsonObject = Record<string, unknown>;

export const demoQuote: CommerceQuote = {
  quoteId: "pinned-quote-v1",
  merchant: "Pinned apparel demo",
  variantId: "shoes-demo-v1",
  amountMinor: 2_900,
  currency: "USD",
  available: true,
  source: "PINNED_DEMO",
  retrievedAt: "2026-08-02T00:00:00.000Z",
};

export function createDemoQuote(): CommerceQuote {
  return {
    ...demoQuote,
    quoteId: randomUUID(),
    retrievedAt: new Date().toISOString(),
  };
}

export function approvalLaunchUrl(appUrl: string, approvalUrl: string): string {
  const target = new URL(approvalUrl);
  if (
    target.protocol !== "https:"
    || target.hostname !== "sandbox.collect.prava.space"
  ) {
    throw new Error("Prava approval URL is invalid");
  }
  const launch = new URL("/api/approval-launch", appUrl);
  launch.searchParams.set("target", target.href);
  return launch.href;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function baseUrl(): string {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ?? process.env.VERCEL_URL
    ?? "closet-before-cart.vercel.app";
  return host.startsWith("http") ? host.replace(/\/$/, "") : `https://${host}`;
}

function approvalMessage(result: PravaPaymentResult): string {
  if (result.status === "APPROVED") {
    return "Prava sandbox approval recorded. No merchant order was placed and no real money moved.";
  }
  if (result.status === "DECLINED") {
    const detail = result.error
      ? ` (${result.error.code}): ${result.error.message}`
      : "";
    return `Prava sandbox approval was declined${detail}. Nothing was ordered or charged.`;
  }
  return "Prava is still processing the sandbox approval. Nothing has been ordered.";
}

function approvalFailure(error: unknown): { errorCode: string; errorMessage: string } {
  if (error instanceof PravaGatewayError) {
    return { errorCode: error.code, errorMessage: error.message };
  }
  return {
    errorCode: "CHECKOUT_START_FAILED",
    errorMessage: "Checkout or sandbox approval could not be initialized safely",
  };
}

function createRuntime() {
  const connectionString = required("DATABASE_URL");
  const sql = neon(connectionString);
  const query = (text: string, values: readonly unknown[]) => sql.query(text, [...values]);
  const appUrl = baseUrl();
  const proofCodec = createRuntimeProofCodec(required("STYLE_PROOF_SECRET"));
  const openAI = createOpenAIWardrobeAdapter({ apiKey: required("OPENAI_API_KEY") });
  const linq = createLinqGateway({ apiKey: required("LINQ_API_KEY") });
  const store = createCaseStore({ baseUrl: appUrl, query });

  const startApproval = async (
    proof: StyleProof,
    category: GarmentCategory,
    senderId: string,
    constraints: StyleConstraints,
  ) => {
    try {
      const commerce = new PinnedCommerceAdapter(createDemoQuote());
      const quote = await commerce.findGapItem(category, constraints);
      const bound = await bindQuoteToProof(proof, quote, proofCodec, new Date().toISOString(), 900);
      const prava = createPravaGateway({
        secretKey: required("PRAVA_API_SECRET_KEY"),
        userEmail: required("PRAVA_USER_EMAIL"),
        callbackUrl: `${appUrl}/api/prava-return?case=${encodeURIComponent(proof.caseId)}`,
        merchantUrl: appUrl,
      });
      const approval = await prava.requestApproval(bound, quote, senderId);
      await store.saveApproval(quote, bound, approval);
      return {
        ...approval,
        approvalUrl: approvalLaunchUrl(appUrl, approval.approvalUrl),
      };
    } catch (error) {
      return approvalFailure(error);
    }
  };

  async function processEvent(event: NormalizedLinqEvent) {
    const continuation = await processShoppingReply(event, {
      loadPending: (senderId) => store.findPendingGap(senderId),
      saveConstraints: (caseId, constraints) => store.saveConstraints(caseId, constraints),
      startApproval,
      reply: async (chatId, message) => { await linq.sendReply(chatId, message); },
    });
    if (continuation !== undefined) return continuation;
    return processWardrobeMessage(event, {
      prepare: (input) => prepareWardrobeIntake(input, { allowedHosts: ["cdn.linqapp.com"] }),
      run: async (input) => runWardrobeCase(
        {
          caseId: input.caseId,
          referencePhotoId: input.referencePhoto.attachmentId,
          referencePhoto: input.referencePhoto.bytes,
          wardrobePhotos: input.wardrobePhotos,
          constraints: input.constraints,
        },
        {
          openAI,
          media: new EphemeralMediaStore(),
          proofCodec,
          now: () => new Date().toISOString(),
          proofTtlSeconds: 900,
        },
      ),
      persist: (source, outcome, constraints) => store.persist(source, outcome, constraints),
      startApproval,
      reply: async (chatId, message) => { await linq.sendReply(chatId, message); },
    });
  }

  return {
    async process(payload: JsonObject) {
      const event = normalizeLinqEvent(payload, required("LINQ_SENDER_ID"));
      if (!event.chatId) return processEvent(event);
      return runWithTyping(event.chatId, () => processEvent(event), linq);
    },

    normalize(payload: JsonObject): NormalizedLinqEvent {
      return normalizeLinqEvent(payload, required("LINQ_SENDER_ID"));
    },

    async completeApproval(chatId: string, eventId: string, approvalId: string) {
      const prava = createPravaGateway({
        secretKey: required("PRAVA_API_SECRET_KEY"),
        userEmail: required("PRAVA_USER_EMAIL"),
        callbackUrl: `${appUrl}/api/prava-return`,
        merchantUrl: appUrl,
      });
      const result = await prava.getResult(approvalId);
      await store.updateApproval(approvalId, result.status, result.error?.code);
      await linq.sendReply(chatId, {
        text: approvalMessage(result),
        idempotencyKey: `${eventId}-prava-${result.status}`,
      });
      return result.status;
    },
  };
}

let runtime: ReturnType<typeof createRuntime> | undefined;

export function getWorkflowRuntime(): ReturnType<typeof createRuntime> {
  runtime ??= createRuntime();
  return runtime;
}
