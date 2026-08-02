import assert from "node:assert/strict";
import test from "node:test";
import { runWithTyping } from "../../src/workflow/typing.ts";

test("keeps typing visible for the operation and clears it afterward", async () => {
  const calls: string[] = [];
  let refresh: (() => void) | undefined;
  const result = await runWithTyping(
    "chat-1",
    async () => {
      calls.push("operation");
      refresh?.();
      await Promise.resolve();
      return "complete";
    },
    {
      startTyping: async () => { calls.push("start"); },
      stopTyping: async () => { calls.push("stop"); },
    },
    {
      every: (callback, milliseconds) => {
        assert.equal(milliseconds, 60_000);
        refresh = callback;
        return "timer";
      },
      cancel: (timer) => { calls.push(`cancel:${timer}`); },
    },
  );

  assert.equal(result, "complete");
  assert.deepEqual(calls, ["start", "operation", "start", "cancel:timer", "stop"]);
});

test("typing failures never hide the operation result or error", async () => {
  const typing = {
    startTyping: async () => { throw new Error("typing unavailable"); },
    stopTyping: async () => { throw new Error("typing unavailable"); },
  };
  const scheduler = {
    every: () => "timer",
    cancel: () => undefined,
  };

  assert.equal(await runWithTyping("chat-1", async () => 42, typing, scheduler), 42);
  await assert.rejects(
    runWithTyping("chat-1", async () => { throw new Error("analysis failed"); }, typing, scheduler),
    /analysis failed/,
  );
});
