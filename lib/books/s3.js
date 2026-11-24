// S3-compatible private object storage (AWS S3, Cloudflare R2, Backblaze B2, MinIO, ...) with AWS
// Signature V4 implemented on node:crypto + fetch, so no SDK or new dependency is needed.
//
// Why: serverless hosts such as Vercel have a read-only / ephemeral disk and cap request and response
// bodies at a few MB. Private books therefore live in a PRIVATE bucket (no public access, no public
// URLs); the browser only ever receives short-lived signed URLs after the server has checked the
// purchase (reads) or the administrator role (uploads).
//
// Path-style URLs (`<endpoint>/<bucket>/<key>`) are used so one code path works for every provider.
// Required environment variables are documented in docs/bookstore/README.md.
import { createHash, createHmac, randomUUID } from "node:crypto";

const sha256 = (d) => createHash("sha256").update(d).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
// RFC 3986 encoding as SigV4 requires.
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encPath = (p) => p.split("/").map(enc).join("/");
const stamp = (d) => d.toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20130524T000000Z

export const EMPTY_SHA256 = sha256("");

function signingKey(secret, date, region, service) {
	return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), "aws4_request");
}

// Header-signed request (Authorization header). `headers` are extra headers to sign (lowercase names).
export function signHeaders({ method, host, path, query = {}, headers = {}, payloadHash, region, service = "s3", accessKeyId, secretAccessKey, now }) {
	const amzDate = stamp(now);
	const date = amzDate.slice(0, 8);
	const all = { ...headers, host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
	const names = Object.keys(all).map((k) => k.toLowerCase()).sort();
	const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, " ")]));
	const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join("");
	const signedHeaders = names.join(";");
	const canonicalQuery = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join("&");
	const canonical = [method, encPath(path), canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
	const scope = `${date}/${region}/${service}/aws4_request`;
	const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
	const signature = createHmac("sha256", signingKey(secretAccessKey, date, region, service)).update(toSign).digest("hex");
	return {
		amzDate,
		signature,
		signedHeaders,
		authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
	};
}

// Query-signed URL (presigned). Only `host` (and any extra signed headers) are bound to the signature.
export function presign({ method, base, path, extraQuery = {}, signedHeaders = {}, ttl, region, service = "s3", accessKeyId, secretAccessKey, now }) {
	const url = new URL(base);
	const amzDate = stamp(now);
	const date = amzDate.slice(0, 8);
	const scope = `${date}/${region}/${service}/aws4_request`;
	const headers = { host: url.host, ...Object.fromEntries(Object.entries(signedHeaders).map(([k, v]) => [k.toLowerCase(), v])) };
	const names = Object.keys(headers).sort();
	const query = { ...extraQuery, "X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Credential": `${accessKeyId}/${scope}`, "X-Amz-Date": amzDate, "X-Amz-Expires": String(ttl), "X-Amz-SignedHeaders": names.join(";") };
	const canonicalQuery = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join("&");
	const canonicalHeaders = names.map((n) => `${n}:${String(headers[n]).trim()}\n`).join("");
	const canonical = [method, encPath(path), canonicalQuery, canonicalHeaders, names.join(";"), "UNSIGNED-PAYLOAD"].join("\n");
	const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
	const signature = createHmac("sha256", signingKey(secretAccessKey, date, region, service)).update(toSign).digest("hex");
	return `${url.origin}${encPath(path)}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export function createS3Storage({ endpoint, bucket, region = "auto", accessKeyId, secretAccessKey, fetchImpl = (...a) => fetch(...a), now = () => new Date() }) {
	if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error("S3 storage is not fully configured");
	const base = new URL(endpoint);
	const pathFor = (key) => `/${bucket}/${key}`;
	const creds = { region, accessKeyId, secretAccessKey };

	async function call(method, key, { body, headers = {}, ok = [200, 204] } = {}) {
		const payloadHash = body ? sha256(body) : EMPTY_SHA256;
		const s = signHeaders({ method, host: base.host, path: pathFor(key), headers, payloadHash, now: now(), ...creds });
		const res = await fetchImpl(`${base.origin}${encPath(pathFor(key))}`, { method, body, headers: { ...headers, "x-amz-date": s.amzDate, "x-amz-content-sha256": payloadHash, Authorization: s.authorization } });
		if (res.status === 404) return null;
		if (!ok.includes(res.status)) throw new Error(`object storage ${method} failed (${res.status})`);
		return res;
	}

	const newKey = (folder, ext) => `${folder}/${randomUUID().replace(/-/g, "")}.${ext}`;
	return {
		kind: "s3",
		newKey,
		async put(folder, ext, buf) {
			const key = newKey(folder, ext);
			await call("PUT", key, { body: buf, headers: { "content-type": ext === "pdf" ? "application/pdf" : `image/${ext === "jpg" ? "jpeg" : ext}` } });
			return key;
		},
		async get(key) {
			const res = await call("GET", key);
			if (!res) throw Object.assign(new Error("not found"), { code: "ENOENT" });
			return Buffer.from(await res.arrayBuffer());
		},
		async getRange(key, start, end) {
			const res = await call("GET", key, { headers: { range: `bytes=${start}-${end}` }, ok: [200, 206] });
			if (!res) throw Object.assign(new Error("not found"), { code: "ENOENT" });
			return Buffer.from(await res.arrayBuffer());
		},
		async head(key) {
			const res = await call("HEAD", key);
			return res ? { size: Number(res.headers.get("content-length")) } : null;
		},
		async exists(key) {
			return !!(await call("HEAD", key));
		},
		async remove(key) {
			await call("DELETE", key, { ok: [200, 204] });
		},
		// The signed Content-Type is bound to the URL: the upload must use exactly this type.
		async presignPut(key, { contentType, ttl = 300 }) {
			return presign({ method: "PUT", base: base.origin, path: pathFor(key), signedHeaders: { "content-type": contentType }, ttl, now: now(), ...creds });
		},
		async presignGet(key, { ttl = 120, contentType = "application/pdf" } = {}) {
			return presign({ method: "GET", base: base.origin, path: pathFor(key), extraQuery: { "response-content-type": contentType, "response-content-disposition": "inline" }, ttl, now: now(), ...creds });
		},
	};
}
