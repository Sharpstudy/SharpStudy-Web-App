// A tiny PDF writer for the original sample pages of the demo books (text only, standard Helvetica).
// No dependency and no downloaded content: the pages are generated from the text in demoData.js.

const ascii = (s) =>
	String(s)
		.replace(/[‘’]/g, "'")
		.replace(/[“”]/g, '"')
		.replace(/[–—]/g, "-")
		.replace(/₹/g, "Rs ")
		.replace(/[^\x20-\x7e]/g, "?");
const esc = (s) => ascii(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

// Greedy word wrap on an approximate Helvetica width (0.5 em per character).
function wrap(text, size, width) {
	const max = Math.max(10, Math.floor(width / (size * 0.5)));
	const out = [];
	let line = "";
	for (const word of ascii(text).split(/\s+/)) {
		if ((line + " " + word).trim().length > max) {
			out.push(line);
			line = word;
		} else line = (line + " " + word).trim();
	}
	if (line) out.push(line);
	return out;
}

// pages: [{ heading, lines: [string] }] on A5 portrait. Returns a Buffer.
export function buildPdf(title, pages) {
	const W = 420;
	const H = 595;
	const objs = [];
	const add = (body) => objs.push(body) && objs.length; // 1-based object number
	const catalog = add("<< /Type /Catalog /Pages 2 0 R >>"); // 1
	add("PLACEHOLDER"); // 2: pages tree, patched below
	const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"); // 3
	const bold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"); // 4
	const kids = [];
	pages.forEach((p, i) => {
		const ops = [];
		let y = H - 70;
		ops.push(`BT /F2 18 Tf 40 ${y} Td (${esc(p.heading)}) Tj ET`);
		y -= 34;
		for (const para of p.lines) {
			for (const l of wrap(para, 12, W - 80)) {
				ops.push(`BT /F1 12 Tf 40 ${y} Td (${esc(l)}) Tj ET`);
				y -= 18;
			}
			y -= 8;
		}
		ops.push(`BT /F1 9 Tf 40 28 Td (${esc(title)}  -  page ${i + 1} of ${pages.length}) Tj ET`);
		const stream = ops.join("\n");
		const content = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
		kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`));
	});
	objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

	let out = "%PDF-1.4\n";
	const offsets = [];
	objs.forEach((body, i) => {
		offsets.push(Buffer.byteLength(out));
		out += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xref = Buffer.byteLength(out);
	out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
	for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
	out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(out, "latin1");
}

const NOTICE = "This is a fictional DEMO book created by SharpStudy for development and demonstrations. It is not a real publication, and its price is a placeholder.";

// The full sample (a few pages) and the shorter public preview (two pages).
export function demoBookPdf(book) {
	return buildPdf(book.title, [
		{ heading: book.title, lines: [`by ${book.author}`, book.description, NOTICE] },
		{ heading: "Sample chapter", lines: book.sample },
		{ heading: "Try it yourself", lines: ["Read the lines on the previous page aloud, then explain one of them in your own words.", "Ask a friend or a grown-up to check your answer."] },
		{ heading: "About this demo", lines: [NOTICE, "Edit or unpublish this record in the SharpStudy admin dashboard at any time."] },
	]);
}
export function demoPreviewPdf(book) {
	return buildPdf(`${book.title} (preview)`, [
		{ heading: book.title, lines: [`by ${book.author}`, book.description, NOTICE] },
		{ heading: "Preview", lines: book.sample.slice(0, 2).concat(["The rest of this demo book is available after purchase."]) },
	]);
}

// An original cover (SVG, self-contained): title on a colour block with a simple geometric motif.
export function demoCoverSvg(book) {
	const h = book.hue;
	const words = ascii(book.title).split(" ");
	const lines = [];
	let cur = "";
	for (const w of words) {
		if ((cur + " " + w).trim().length > 16) {
			lines.push(cur);
			cur = w;
		} else cur = (cur + " " + w).trim();
	}
	if (cur) lines.push(cur);
	const text = lines.slice(0, 5).map((l, i) => `<text x="150" y="${150 + i * 30}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700" fill="#fff">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`).join("");
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400" role="img" aria-label="${ascii(book.title).replace(/"/g, "&quot;").replace(/&/g, "&amp;")}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h} 60% 40%)"/><stop offset="1" stop-color="hsl(${(h + 45) % 360} 65% 26%)"/></linearGradient></defs><rect width="300" height="400" fill="url(#g)"/><circle cx="240" cy="70" r="46" fill="hsl(${(h + 20) % 360} 80% 70%)" opacity=".35"/><rect x="28" y="300" width="244" height="6" rx="3" fill="#fff" opacity=".5"/><text x="150" y="338" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="13" fill="#fff" opacity=".9">${ascii(book.author).replace(/&/g, "&amp;")}</text><text x="150" y="376" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="11" letter-spacing="2" fill="#fff" opacity=".8">DEMO BOOK</text>${text}</svg>\n`;
}
