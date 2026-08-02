import type { NormalizedLinqEvent } from "../adapters/linq.js";
import type { StyleProof } from "../contracts/domain.js";
import {
  mergeShoppingDetails,
  ShoppingDetailsError,
  shoppingDetailsPrompt,
} from "../domain/shopping-details.js";
import type { GarmentCategory, StyleConstraints } from "../domain/style-gap.js";
import type { ProcessWardrobeResult, WorkflowReply } from "./process-case.js";

type ApprovalStart =
  | { readonly approvalId: string; readonly approvalUrl: string }
  | { readonly errorCode: string; readonly errorMessage: string };

interface PendingGap {
  readonly proof: StyleProof;
  readonly constraints: StyleConstraints;
}

export interface ProcessShoppingDependencies {
  readonly loadPending: (senderId: string) => Promise<PendingGap | null>;
  readonly saveConstraints: (caseId: string, constraints: StyleConstraints) => Promise<void>;
  readonly startApproval: (
    proof: StyleProof,
    category: GarmentCategory,
    senderId: string,
    constraints: StyleConstraints,
  ) => Promise<ApprovalStart>;
  readonly reply: (chatId: string, message: WorkflowReply) => Promise<void>;
}

function approvalText(approval: ApprovalStart): string {
  if ("errorCode" in approval) {
    if (approval.errorCode === "NO_EXACT_OPTION") {
      return `${approval.errorMessage}. Please revise the US shoe size or maximum budget. No checkout was started.`;
    }
    return `Checkout could not start (${approval.errorCode}): ${approval.errorMessage}. No transaction was retried.`;
  }
  return [
    "One wardrobe gap remains.",
    "Open this fresh Prava sandbox approval in a normal Safari or Chrome window on a device with biometrics enabled:",
    approval.approvalUrl,
  ].join(" ");
}

async function replyToInvalidDetails(
  chatId: string,
  eventId: string,
  text: string,
  dependencies: ProcessShoppingDependencies,
): Promise<ProcessWardrobeResult> {
  await dependencies.reply(chatId, {
    text,
    idempotencyKey: `${eventId}-shopping-details-invalid`,
  });
  return { caseId: eventId, decision: "GAP_FOUND" };
}

async function replyForMissingDetails(
  chatId: string,
  eventId: string,
  caseId: string,
  prompt: string,
  dependencies: ProcessShoppingDependencies,
): Promise<ProcessWardrobeResult> {
  await dependencies.reply(chatId, {
    text: prompt,
    idempotencyKey: `${eventId}-shopping-details`,
  });
  return { caseId, decision: "GAP_FOUND" };
}

async function startAndReply(
  event: NormalizedLinqEvent & { readonly chatId: string },
  pending: PendingGap,
  category: GarmentCategory,
  constraints: StyleConstraints,
  dependencies: ProcessShoppingDependencies,
): Promise<ProcessWardrobeResult> {
  const approval = await dependencies.startApproval(
    pending.proof,
    category,
    event.senderId,
    constraints,
  );
  await dependencies.reply(event.chatId, {
    text: approvalText(approval),
    idempotencyKey: `${event.eventId}-shopping-approval`,
  });
  return {
    caseId: pending.proof.caseId,
    decision: "GAP_FOUND",
    ...("approvalId" in approval ? { approvalId: approval.approvalId } : {}),
  };
}

export async function processShoppingReply(
  event: NormalizedLinqEvent,
  dependencies: ProcessShoppingDependencies,
): Promise<ProcessWardrobeResult | undefined> {
  if (!event.chatId || !event.text || event.attachments.length > 0) return undefined;
  const pending = await dependencies.loadPending(event.senderId);
  if (pending === null) return undefined;
  const category = pending.proof.missingCategory;
  if (category === undefined) return undefined;
  let constraints: StyleConstraints;
  try {
    constraints = mergeShoppingDetails(pending.constraints, event.text, category);
  } catch (error) {
    const text = error instanceof ShoppingDetailsError
      ? error.message
      : "I couldn't safely read that. Please choose men's or women's, then include the size and maximum budget once.";
    const result = await replyToInvalidDetails(event.chatId, event.eventId, text, dependencies);
    return { ...result, caseId: pending.proof.caseId };
  }
  await dependencies.saveConstraints(pending.proof.caseId, constraints);
  const prompt = shoppingDetailsPrompt(category, constraints);
  if (prompt !== undefined) {
    return replyForMissingDetails(
      event.chatId,
      event.eventId,
      pending.proof.caseId,
      prompt,
      dependencies,
    );
  }
  return startAndReply(
    { ...event, chatId: event.chatId },
    pending,
    category,
    constraints,
    dependencies,
  );
}
