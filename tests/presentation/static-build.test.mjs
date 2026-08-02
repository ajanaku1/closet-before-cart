import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("static build emits the selected Open Wardrobe proof page", async () => {
  const build = spawnSync(process.execPath, ["scripts/build.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(build.status, 0, build.stderr);
  const html = await readFile(".build/public/index.html", "utf8");
  const css = await readFile(".build/public/style.css", "utf8");

  assert.match(html, /You need one thing/);
  assert.match(html, /Synthetic editorial preview/);
  assert.match(html, /department, US shoe size, and maximum budget/i);
  assert.match(html, /How CBC works/);
  assert.match(html, /tel:\+13109269508/);
  assert.match(html, /\/images\/editorial-look\.jpg/);
  assert.match(html, /<script src="\/script\.js" defer><\/script>/);
  assert.doesNotMatch(html, /Review permission|Pinned apparel|\$29\.00/);
  assert.match(css, /--sky:#69bceb/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\[data-reveal\]/);
  assert.doesNotMatch(css, /--ink:#101114|background:var\(--ink\)/);
});
