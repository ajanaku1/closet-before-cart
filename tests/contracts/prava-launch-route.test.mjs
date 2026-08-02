import assert from "node:assert/strict";
import test from "node:test";
import handler from "../../api/approval-launch.mjs";

function responseRecorder() {
  const headers = new Map();
  return {
    headers,
    statusCode: 0,
    body: "",
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    end(body) { this.body = String(body); },
  };
}

test("renders a button without automatically opening the one-time Prava URL", () => {
  const target = "https://sandbox.collect.prava.space/s/session-1";
  const response = responseRecorder();

  handler({ method: "GET", url: `/api/approval-launch?target=${encodeURIComponent(target)}` }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.get("location"), undefined);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.body, new RegExp(`href="${target}"`));
  assert.match(response.body, /Open Prava approval/);
});

test("rejects a launch target outside Prava", () => {
  const response = responseRecorder();

  handler({ method: "GET", url: "/api/approval-launch?target=https%3A%2F%2Fexample.com%2Fs%2F1" }, response);

  assert.equal(response.statusCode, 400);
  assert.doesNotMatch(response.body, /href=/);
});

test("accepts current Prava links without assuming a fixed path shape", () => {
  const response = responseRecorder();
  const target = "https://sandbox.collect.prava.space/checkout/session-2";

  handler({ method: "GET", url: `/api/approval-launch?target=${encodeURIComponent(target)}` }, response);

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /checkout\/session-2/);
});
