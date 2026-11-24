// Browser regression test: the family / learner pages must not be wider than the phone viewport (Phase 7.1 D).
// Root cause that was fixed: visually-hidden (.ss-sr-only, absolutely positioned) labels inside .ss-table-wrap were not clipped by the
// scrolling wrapper and widened the whole page (scrollWidth 570 at 390 px). The wrapper is now position: relative.
//   node tests/e2e-pg/family-overflow.mjs <baseUrl> <secret> <fixtures.json> <outDir>
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const [, , base, secret, fx, outDir] = process.argv;
const widths = [390, 414, 440, 768, 1366];
const pages = ["instructor::/family/", "student::/family/", "instructor::/admin/mastery/"];
const specs = pages.map((p) => `${p}::${widths.join(",")}`);
const r = spawnSync(process.execPath, ["--no-warnings", fileURLToPath(new URL("./browser-probe.mjs", import.meta.url)), base, secret, fx, outDir, ...specs], { encoding: "utf8", env: { ...process.env, PROBE_SETTLE: process.env.PROBE_SETTLE || "6000", MSYS_NO_PATHCONV: "1" } });
const rows = r.stdout.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
assert.equal(rows.length, pages.length * widths.length, `expected ${pages.length * widths.length} page views, got ${rows.length}\n${r.stderr}`);
let n = 0;
for (const row of rows) {
	// 1366 px desktops reserve room for the scrollbar, so only "not wider than the viewport" is asserted.
	assert.ok(row.scrollWidth <= row.width, `${row.who} ${row.page} @${row.width}px: page is ${row.scrollWidth}px wide`);
	assert.deepEqual(row.offenders, [], `${row.who} ${row.page} @${row.width}px: elements outside the viewport`);
	n++;
}
console.log(`family-overflow: ${n} page views fit their viewport (${widths.join("/")} px)`);
