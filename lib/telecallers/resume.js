// Resume upload validation. Pure: takes the browser's { filename, data } (data = base64) and returns the checked file.
//
//  - The size limit is enforced on the base64 text BEFORE it is decoded, and again on the decoded bytes.
//  - The type is decided from the file's real signature, never from the browser's claimed MIME type or the extension alone:
//      PDF  starts with "%PDF-"
//      DOC  starts with the OLE2 header AND contains a "WordDocument" stream (so Excel / PowerPoint files are refused)
//      DOCX is a ZIP ("PK\x03\x04") that contains "[Content_Types].xml" and "word/" entries
//    and the filename extension must agree with the detected type.
//  - The stored MIME type is the one we derive here, so a download can only ever be served as one of these three types.
//  This is a format check, not a malware scan. The file is stored privately and only an admin can download it.
import { createHash } from "node:crypto";
import { RESUME } from "./rules.js";

export class ResumeError extends Error {
	constructor(code, message) {
		super(message);
		this.code = code;
	}
}

const MIME = {
	pdf: "application/pdf",
	doc: "application/msword",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
export const mimeFor = (ext) => MIME[ext] || null;

const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const WORD_STREAM = Buffer.from("WordDocument", "utf16le");

export function detectType(buf) {
	if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
	if (buf.length >= 8 && buf.subarray(0, 8).equals(OLE2) && buf.includes(WORD_STREAM)) return "doc";
	if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04 && buf.includes("[Content_Types].xml") && buf.includes("word/")) return "docx";
	return null;
}

// A safe display / download name: no path, no control characters, at most 200 characters, the detected extension.
export function cleanFilename(name, ext) {
	let base = String(name == null ? "" : name).split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"<>:*?|]+/g, "").replace(/\s+/g, " ").trim();
	base = base.replace(/\.[A-Za-z0-9]{1,5}$/, "");
	if (!base) base = "resume";
	return `${base.slice(0, 190)}.${ext}`;
}

export function checkResume({ filename, data } = {}) {
	if (typeof data !== "string" || !data) throw new ResumeError("missing_file", "Choose a resume file to upload.");
	const rawExt = (String(filename || "").match(/\.([A-Za-z0-9]{1,5})$/) || [])[1];
	const claimed = rawExt ? rawExt.toLowerCase() : "";
	if (!RESUME.extensions.includes(claimed)) throw new ResumeError("bad_type", "The resume must be a PDF, DOC or DOCX file.");

	let b64 = data.replace(/^data:[^;,]*;base64,/i, "").replace(/\s+/g, "");
	// size first, on the text: 4 base64 characters carry 3 bytes
	if (b64.length > Math.ceil(RESUME.maxBytes / 3) * 4 + 8) throw new ResumeError("too_large", "The resume is larger than 2 MB.");
	if (!b64 || b64.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new ResumeError("bad_file", "The file could not be read. Choose the file again.");
	const buffer = Buffer.from(b64, "base64");
	if (!buffer.length) throw new ResumeError("bad_file", "The file is empty.");
	if (buffer.length > RESUME.maxBytes) throw new ResumeError("too_large", "The resume is larger than 2 MB.");

	const ext = detectType(buffer);
	if (!ext) throw new ResumeError("bad_type", "The file is not a valid PDF, DOC or DOCX document.");
	if (ext !== claimed) throw new ResumeError("type_mismatch", `The file is a ${ext.toUpperCase()} document but its name ends in .${claimed}.`);
	return {
		buffer,
		ext,
		mime: MIME[ext],
		size: buffer.length,
		sha256: createHash("sha256").update(buffer).digest("hex"),
		filename: cleanFilename(filename, ext),
	};
}
