import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GET } from "../../app/.well-known/ucp/route.ts";

const deployedModule = await import("../../api/ucp.mjs").catch(() => ({}));

test("publishes CBC commerce capabilities without private configuration", async () => {
  const response = await GET();
  const profile = await response.json();
  const capabilityNames = Object.keys(profile.ucp?.capabilities ?? {}).sort();

  assert.equal(response.status, 200);
  assert.equal(profile.ucp?.version, "2026-04-08");
  assert.equal(profile.ucp?.services?.["dev.ucp.shopping"]?.[0]?.transport, "mcp");
  assert.deepEqual(capabilityNames, [
    "dev.ucp.shopping.cart",
    "dev.ucp.shopping.catalog.lookup",
    "dev.ucp.shopping.catalog.search",
    "dev.ucp.shopping.checkout",
  ]);
  assert.deepEqual(profile.ucp?.payment_handlers, {});
  assert.match(response.headers.get("cache-control") ?? "", /public.*max-age=/);
  assert.equal(JSON.stringify(profile).includes("secret"), false);
  assert.equal(JSON.stringify(profile).includes("token"), false);
});

test("serves the same UCP profile from the deployed Vercel function", async () => {
  assert.equal(typeof deployedModule.default, "function", "deployed UCP handler must exist");
  const response = {
    statusCode: 0,
    headers: new Map<string, string>(),
    body: "",
    setHeader(name: string, value: string) {
      this.headers.set(name.toLowerCase(), value);
    },
    end(body: string) {
      this.body = body;
    },
  };

  await deployedModule.default({ method: "GET" }, response);

  assert.equal(response.statusCode, 200);
  const appProfile = await (await GET()).json();
  assert.deepEqual(JSON.parse(response.body), appProfile);
  assert.match(response.headers.get("cache-control") ?? "", /public.*max-age=/);
});

test("keeps the deployed ESM function free of runtime TypeScript imports", async () => {
  const source = await readFile(new URL("../../api/ucp.mjs", import.meta.url), "utf8");

  assert.doesNotMatch(source, /from\s+["'][^"']+\.ts["']/);
});

test("rewrites the well-known UCP URL to its deployed function", async () => {
  const config = JSON.parse(await readFile(new URL("../../vercel.json", import.meta.url), "utf8"));

  assert.ok(config.rewrites?.some((rewrite: Record<string, unknown>) =>
    rewrite.source === "/.well-known/ucp" && rewrite.destination === "/api/ucp"));
});
