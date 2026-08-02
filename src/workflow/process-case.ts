import type { NormalizedLinqEvent } from "../adapters/linq.js";
import type { StyleProof } from "../contracts/domain.js";
import type { PreparedWardrobeIntake } from "../domain/intake.js";
import type { WardrobeCaseOutcome } from "../domain/case-runner.js";
import { shoppingDetailsPrompt } from "../domain/shopping-details.js";
import type { GarmentCategory, StyleConstraints } from "../domain/style-gap.js";

export interface WorkflowReply {
  readonly text?: string;
  readonly imageUrl?: string;
  readonly idempotencyKey: string;
}

export interface ProcessWardrobeDependencies {
  readonly prepare: (event: NormalizedLinqEvent) => Promise<PreparedWardrobeIntake>;
  readonly run: (input: PreparedWardrobeIntake & { readonly caseId: string }) => Promise<WardrobeCaseOutcome>;
  readonly persist: (
    event: NormalizedLinqEvent,
    outcome: WardrobeCaseOutcome,
    constraints: StyleConstraints,
  ) => Promise<{ previewUrl: string; proofUrl: string }>;
  readonly startApproval: (
    proof: StyleProof,
    missingCategory: GarmentCategory,
    senderId: string,
    constraints: StyleConstraints,
  ) => Promise<
    | { readonly approvalId: string; readonly approvalUrl: string }
    | { readonly errorCode: string; readonly errorMessage: string }
  >;
  readonly reply: (chatId: string, message: WorkflowReply) => Promise<void>;
}

type ApprovalStart = Awaited<ReturnType<ProcessWardrobeDependencies["startApproval"]>>;

function isApprovalFailure(value: ApprovalStart): value is Extract<ApprovalStart, { errorCode: string }> {
  return "errorCode" in value;
}

function approvalAction(value: ApprovalStart): string {
  if (isApprovalFailure(value)) {
    return `Checkout or Prava approval could not start (${value.errorCode}): ${value.errorMessage}. No transaction was retried.`;
  }
  return [
    "One wardrobe gap remains.",
    "Open this fresh Prava sandbox approval in a normal Safari or Chrome window on a device with biometrics enabled:",
    value.approvalUrl,
  ].join(" ");
}

export interface ProcessWardrobeResult {
  readonly caseId: string;
  readonly decision: WardrobeCaseOutcome["result"]["decision"];
  readonly approvalId?: string;
}

function evidenceMessage(outcome: WardrobeCaseOutcome): string {
  const category = outcome.result.missingCategories[0]?.toLowerCase();
  return category
    ? `I need a clearer photo showing your ${category} before I can make a safe recommendation.`
    : "I need a clearer photo of each wardrobe item before I can make a safe recommendation.";
}

function intakeRecoveryMessage(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  if (error.message === "A supported occasion and one-item limit are required") {
    return "I received your message, but the shopping brief was missing. Please send the seven photos together with: Friday wedding, no black, one new item maximum";
  }
  if (error.message === "Seven image attachments are required") {
    return "I received your message, but I need exactly seven images in one message: one reference outfit followed by six wardrobe items.";
  }
  if (error.message === "Unsupported image format") {
    return "I couldn't read one of the attachments. Please resend all seven images as JPEG, PNG, or WebP files.";
  }
  return undefined;
}

async function prepareOrRecover(
  event: NormalizedLinqEvent,
  chatId: string,
  dependencies: ProcessWardrobeDependencies,
): Promise<{ intake: PreparedWardrobeIntake } | { result: ProcessWardrobeResult }> {
  try {
    return { intake: await dependencies.prepare(event) };
  } catch (error) {
    const recovery = intakeRecoveryMessage(error);
    if (recovery === undefined) throw error;
    await dependencies.reply(chatId, {
      text: recovery,
      idempotencyKey: `${event.eventId}-intake-recovery`,
    });
    return {
      result: { caseId: event.eventId, decision: "MORE_EVIDENCE" },
    };
  }
}

async function replyWithEvidence(
  event: NormalizedLinqEvent,
  chatId: string,
  outcome: WardrobeCaseOutcome,
  dependencies: ProcessWardrobeDependencies,
): Promise<ProcessWardrobeResult> {
  await dependencies.reply(chatId, {
    text: evidenceMessage(outcome),
    idempotencyKey: `${event.eventId}-evidence`,
  });
  return { caseId: event.eventId, decision: outcome.result.decision };
}

export async function processWardrobeMessage(
  event: NormalizedLinqEvent,
  dependencies: ProcessWardrobeDependencies,
): Promise<ProcessWardrobeResult> {
  if (!event.chatId) throw new Error("Linq event is missing chat id");
  const prepared = await prepareOrRecover(event, event.chatId, dependencies);
  if ("result" in prepared) return prepared.result;
  const outcome = await dependencies.run({ ...prepared.intake, caseId: event.eventId });
  if (outcome.result.decision === "MORE_EVIDENCE") {
    return replyWithEvidence(event, event.chatId, outcome, dependencies);
  }
  if (!outcome.proof || !outcome.previewUrl) throw new Error("Completed case is missing proof output");
  const stored = await dependencies.persist(event, outcome, prepared.intake.constraints);
  let approval: ApprovalStart | undefined;
  if (outcome.result.decision === "GAP_FOUND") {
    const missing = outcome.result.missingCategories[0];
    if (!missing) throw new Error("Gap result is missing its category");
    const detailsPrompt = shoppingDetailsPrompt(missing, prepared.intake.constraints);
    if (detailsPrompt !== undefined) {
      await dependencies.reply(event.chatId, {
        text: detailsPrompt,
        imageUrl: stored.previewUrl,
        idempotencyKey: `${event.eventId}-shopping-details`,
      });
      return { caseId: event.eventId, decision: outcome.result.decision };
    }
    approval = await dependencies.startApproval(
      outcome.proof,
      missing,
      event.senderId,
      prepared.intake.constraints,
    );
  }
  const action = approval
    ? approvalAction(approval)
    : `Your wardrobe already covers the occasion. Style proof: ${stored.proofUrl}`;
  await dependencies.reply(event.chatId, {
    text: action,
    imageUrl: stored.previewUrl,
    idempotencyKey: `${event.eventId}-result`,
  });
  return {
    caseId: event.eventId,
    decision: outcome.result.decision,
    ...(approval === undefined || isApprovalFailure(approval)
      ? {}
      : { approvalId: approval.approvalId }),
  };
}
