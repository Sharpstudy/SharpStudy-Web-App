// Lists every asset a page references (script/link/img/source/video, plus url(...) in inline style) and measures size,
// transfer encoding and Cache-Control of each from a RUNNING instance (localhost only).
//   node tests/perf/assets.mjs <baseUrl> <path>
const [, , BASE, PATH = "/"] = process.argv;
if (!/^http:\/\/localhost:\d+$/.test(BASE || "")) throw new Error("localhost only");
const html = await (await fetch(BASE + PATH)).text();
const urls = new Set();
for (const m of html.matchAll(/(?:src|href|poster)="([^"#]+)"/g)) urls.add(m[1]);
for (const m of html.matchAll(/srcSet="([^"]+)"/g)) for (const p of m[1].split(",")) urls.add(p.trim().split(" ")[0]);
const rows = [];
for (const u of urls) {
	if (/^(mailto:|tel:|data:|javascript:)/.test(u)) continue;
	const abs = u.startsWith("http") ? u : u.startsWith("//") ? "https:" + u : BASE + (u.startsWith("/") ? u : "/" + u);
	const external = !abs.startsWith(BASE);
	if (external) { rows.push({ u: abs.slice(0, 70), ext: true }); continue; }
	if (/\.(html?)$/.test(u) || /\/$/.test(u.split("?")[0])) continue; // page links, not assets
	try {
		const r = await fetch(abs, { headers: { "accept-encoding": "gzip" } });
		const buf = await r.arrayBuffer();
		rows.push({ u: u.slice(0, 70), type: (r.headers.get("content-type") || "").split(";")[0], bytes: buf.byteLength, enc: r.headers.get("content-encoding") || "-", cache: r.headers.get("cache-control") || "-", status: r.status });
	} catch (e) { rows.push({ u: u.slice(0, 70), err: e.message }); }
}
const local = rows.filter((r) => !r.ext);
let total = 0;
for (const r of local.sort((a, b) => (b.bytes || 0) - (a.bytes || 0))) { total += r.bytes || 0; console.log(`${String(r.bytes || "-").padStart(9)}  ${String(r.enc).padEnd(5)} ${String(r.cache).slice(0, 38).padEnd(38)} ${r.u}`); }
console.log(`\nlocal assets: ${local.length}, total ${(total / 1024).toFixed(0)} KB as received`);
console.log("external references:", rows.filter((r) => r.ext).map((r) => r.u).join("\n   "));
