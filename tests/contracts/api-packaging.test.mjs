import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : [path];
    }),
  );
  return nested.flat().filter((path) => /\.(?:mjs|ts)$/.test(path));
}

test("Vercel production modules do not import TypeScript source paths at runtime", async () => {
  const violations = [];

  const productionFiles = (
    await Promise.all([sourceFiles("api"), sourceFiles("src")])
  ).flat();

  for (const path of productionFiles) {
    const source = await readFile(path, "utf8");
    if (/from\s+["'][^"']+\.ts["']|import\s*\(["'][^"']+\.ts["']\)/.test(source)) {
      violations.push(path);
    }
  }

  assert.deepEqual(violations, []);
});
