// Node module-resolution hook used ONLY by the PostgreSQL integration tests.
// The application is bundled by Next.js, which understands "@/..." aliases, baseUrl imports ("database/models/user")
// and extension-less relative imports. Plain Node does not, so this hook teaches it the same rules and lets the
// real repositories and models run unchanged under `node --test`.
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = pathToFileURL(process.cwd() + "/").href;
const BASE_URL_DIRS = /^(database|email-templates|lib|utils|store)\//;

const isFile = (url) => {
	try {
		return fs.statSync(fileURLToPath(url)).isFile();
	} catch {
		return false;
	}
};
const firstExisting = (base) => ["", ".js", ".mjs", "/index.js"].map((s) => base + s).find(isFile);

export async function resolve(specifier, context, nextResolve) {
	let base = null;
	if (specifier.startsWith("@/")) base = new URL(specifier.slice(2), root).href;
	else if (BASE_URL_DIRS.test(specifier)) base = new URL(specifier, root).href;
	else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL && context.parentURL.startsWith("file:")) {
		try {
			return await nextResolve(specifier, context);
		} catch (e) {
			base = new URL(specifier, context.parentURL).href;
		}
	}
	if (base) {
		const hit = firstExisting(base);
		if (hit) return nextResolve(hit, context);
	}
	try {
		return await nextResolve(specifier, context);
	} catch (e) {
		// package sub-paths without an extension ("validator/lib/isEmail"): the bundler adds ".js", Node does not
		if (e && e.code === "ERR_MODULE_NOT_FOUND" && !specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.endsWith(".js")) {
			try {
				return await nextResolve(specifier + ".js", context);
			} catch {}
		}
		throw e;
	}
}
