import { access, cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { demoGapProof, renderProofDocument } from "../src/presentation/proof-page.ts";

const root = resolve(new URL("..", import.meta.url).pathname);
const required = [
  "app/page.tsx",
  "app/api/webhooks/linq/route.ts",
  "api/webhooks/linq.mjs",
  "app/api/proof/[token]/route.ts",
  "app/.well-known/ucp/route.ts",
  "public/index.html",
];

for (const file of required) await access(resolve(root, file));

const out = resolve(root, ".build");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(resolve(root, "public"), resolve(out, "public"), { recursive: true });
await writeFile(resolve(out, "public/index.html"), renderProofDocument(demoGapProof));

const proposalDirectory = resolve(root, "proposals");
const proposals = await readdir(proposalDirectory).catch((error) => {
  if (error?.code === "ENOENT") return [];
  throw error;
});
if (proposals.length > 0) {
  await cp(proposalDirectory, resolve(out, "proposals"), { recursive: true });
}
const proposalCount = proposals.filter((file) => file.endsWith(".html")).length;
console.log(`CBC static build ready in .build (${proposalCount} proposals retained)`);
