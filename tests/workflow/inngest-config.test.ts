import assert from "node:assert/strict";
import test from "node:test";
import * as workflow from "../../src/workflow/inngest.ts";

test("does not automatically retry a workflow that can create a Prava session", () => {
  assert.equal(workflow.wardrobeWorkflowRetryCount, 0);
});
