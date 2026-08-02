import { Inngest } from "inngest";
import { getWorkflowRuntime } from "./runtime.js";

export const inngest = new Inngest({ id: "closet-before-cart" });
export const wardrobeWorkflowRetryCount = 0;

export const wardrobeWorkflow = inngest.createFunction(
  {
    id: "process-linq-wardrobe",
    retries: wardrobeWorkflowRetryCount,
    triggers: [{ event: "cbc/linq.message.received" }],
  },
  async ({ event, step }) => {
    const payload = event.data.payload as Record<string, unknown>;
    const normalized = getWorkflowRuntime().normalize(payload);
    const chatId = normalized.chatId;
    if (!chatId) throw new Error("Linq event is missing chat id");
    const outcome = await step.run("process-wardrobe-case", () =>
      getWorkflowRuntime().process(payload));
    if (!outcome.approvalId) return outcome;
    const returned = await step.waitForEvent("wait-for-prava-return", {
      event: "cbc/prava.returned",
      timeout: "20m",
      if: `async.data.approvalId == ${JSON.stringify(outcome.approvalId)}`,
    });
    if (!returned) return { ...outcome, approvalStatus: "EXPIRED" };
    const approvalId = String(returned.data.approvalId);
    const status = await step.run("complete-prava-approval", () =>
      getWorkflowRuntime().completeApproval(
        chatId,
        normalized.eventId,
        approvalId,
      ));
    return { ...outcome, approvalStatus: status };
  },
);
