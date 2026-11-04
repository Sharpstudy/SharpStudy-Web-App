// Private file storage for books and covers.
//
// Files live OUTSIDE `public/` and are never addressable by URL: the only way to read one is through
// an API route that has already authorised the request (lib/books/service.js). Keys are generated here
// (never taken from the client), so a request can neither choose nor traverse a path.
//
// Drivers (chosen by storageFromEnv):
//   S3-compatible private bucket  when BOOK_S3_* is set (lib/books/s3.js) - the right choice on Vercel
//   local disk (BOOK_STORAGE_DIR)  for a server / Docker / pm2 with a persistent volume, and for development
//   "not configured"               on Vercel without a bucket: every operation fails with a clear 503 instead
//                                   of silently writing to an ephemeral disk where files would vanish
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BookError } from "./errors.js";
import { createS3Storage } from "./s3.js";

const KEY_RE = /^(covers|files)\/[0-9a-f]{32}\.(png|jpg|webp|pdf)$/;

export const isStorageKey = (k) => typeof k === "string" && KEY_RE.test(k);

export function createLocalStorage(root = process.env.BOOK_STORAGE_DIR || path.join(process.cwd(), ".book-storage")) {
	const resolve = (key) => {
		if (!isStorageKey(key)) throw new Error("invalid storage key");
		const full = path.resolve(root, key);
		if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error("invalid storage key");
		return full;
	};
	const newKey = (folder, ext) => `${folder}/${randomUUID().replace(/-/g, "")}.${ext}`;
	return {
		kind: "local",
		newKey,
		async put(folder, ext, buf) {
			const key = newKey(folder, ext);
			const full = resolve(key);
			await fs.promises.mkdir(path.dirname(full), { recursive: true });
			await fs.promises.writeFile(full, buf, { flag: "wx", mode: 0o600 });
			return key;
		},
		async get(key) {
			return fs.promises.readFile(resolve(key));
		},
		async exists(key) {
			return fs.promises.access(resolve(key)).then(() => true, () => false);
		},
		async remove(key) {
			await fs.promises.unlink(resolve(key)).catch((e) => {
				if (e.code !== "ENOENT") throw e;
			});
		},
	};
}

export const memoryStorage = () => {
	const files = new Map();
	return {
		files,
		newKey: (folder, ext) => `${folder}/${randomUUID().replace(/-/g, "")}.${ext}`,
		async put(folder, ext, buf) {
			const key = `${folder}/${randomUUID().replace(/-/g, "")}.${ext}`;
			files.set(key, Buffer.from(buf));
			return key;
		},
		async get(key) {
			if (!files.has(key)) throw Object.assign(new Error("not found"), { code: "ENOENT" });
			return files.get(key);
		},
		async exists(key) {
			return files.has(key);
		},
		async remove(key) {
			files.delete(key);
		},
	};
};

const NOT_CONFIGURED = "Book file storage is not configured on this server. Set the BOOK_S3_* environment variables (see docs/bookstore/README.md).";
export const unconfiguredStorage = () => {
	const refuse = async () => {
		throw new BookError(503, "storage_not_configured", NOT_CONFIGURED);
	};
	return { kind: "none", newKey: () => "", put: refuse, get: refuse, exists: refuse, remove: refuse };
};

export function storageFromEnv(env = process.env) {
	const { BOOK_S3_ENDPOINT: endpoint, BOOK_S3_BUCKET: bucket, BOOK_S3_ACCESS_KEY_ID: accessKeyId, BOOK_S3_SECRET_ACCESS_KEY: secretAccessKey, BOOK_S3_REGION: region } = env;
	if (endpoint && bucket && accessKeyId && secretAccessKey) return createS3Storage({ endpoint, bucket, accessKeyId, secretAccessKey, region: region || "auto" });
	if (env.VERCEL) return unconfiguredStorage();
	return createLocalStorage(env.BOOK_STORAGE_DIR || undefined);
}

let shared;
export const getStorage = () => shared || (shared = storageFromEnv());
