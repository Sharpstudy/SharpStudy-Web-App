// Module-resolution hook for the Phase 7 e2e runs: `mysql2/promise` resolves to the PostgreSQL shim, so the existing scripts
// can never open a MySQL connection. (Everything else resolves normally.)
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const shim = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "mysql2-shim.mjs")).href;

export async function resolve(specifier, context, nextResolve) {
	if (specifier === "mysql2/promise" || specifier === "mysql2") return { url: shim, shortCircuit: true };
	return nextResolve(specifier, context);
}
