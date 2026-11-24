// Exploratory sweep (not part of yarn test): calls every repository method with assorted arguments against the throw-away
// PostgreSQL schema and reports real SQL problems (syntax / unknown column / type). Data-rule errors from made-up arguments are noise.
//   node --no-warnings tests/db/pg/sweep-repositories.mjs
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createTestSchema, dropTestSchema, publicRowTotal } from "./schema.mjs";
register("./hooks.mjs", import.meta.url);
process.on("uncaughtException", () => {});
process.on("unhandledRejection", () => {});
const schema = await createTestSchema();
process.env.DB_DIALECT = "postgres";
process.env.PG_SEARCH_PATH = schema;
process.env.JWT_SECRET = "sweep";
const load = (p) => import(pathToFileURL(path.join(process.cwd(), p)).href);
const repos = {
	mastery: "lib/mastery-server/repo.js", meetings: "lib/meetings/repo.js", telecallers: "lib/telecallers/repo.js", followups: "lib/followups/repo.js",
	instructorApps: "lib/instructor-applications/repo.js", books: "lib/books/repo.js", liveSessions: "lib/live-sessions/repo.js", liveQuestions: "lib/live-questions/repo.js",
	family: "lib/family/repo.js", removals: "lib/removals/repo.js", accounts: "lib/admin/accountsRepo.js", instructorProfile: "lib/instructor/profileRepo.js", instructorDetails: "lib/admin/instructorDetailsRepo.js",
};
const U = () => randomUUID();
const argSets = () => [[], [U()], [U(), U()], [U(), U(), U()], [{}], [{ q: "x", page: 1, pageSize: 10, limit: 10, offset: 0, status: "pending", statuses: ["pending"], filter: "all" }], [{ q: "x", page: 1, pageSize: 10 }, { userId: U() }], ["x"], [[U()]], [U(), "x"], [new Date()]];
const ignorable = (code) => /^23/.test(String(code)); // data rules (FK / NOT NULL / unique / check) triggered by made-up arguments
const problems = [];
let calls = 0, dbErrors = 0, methods = 0;
for (const [name, file] of Object.entries(repos)) {
	let mod;
	try { mod = await load(file); } catch (e) { problems.push(`${name}: cannot load: ${e.message.slice(0, 120)}`); continue; }
	const repo = mod.default;
	const targets = typeof repo === "function" ? {} : repo;
	for (const [m, fn] of Object.entries(targets)) {
		if (typeof fn !== "function") continue;
		methods++;
		const seen = new Set();
		for (const args of argSets()) {
			calls++;
			try { await Promise.race([fn.apply(repo, args), new Promise((_, rej) => setTimeout(() => rej(new Error("TIMEOUT")), 8000))]); }
			catch (e) {
				const code = e && (e.parent && e.parent.code);
				if (e && /^Sequelize(Database|ForeignKey|UniqueConstraint|Validation|Connection)/.test(e.name || "") || code) {
					dbErrors++;
					if (!ignorable(code) && e.name !== "SequelizeValidationError") {
						const key = `${code}:${(e.parent && e.parent.message) || e.message}`.slice(0, 160);
						if (!seen.has(key)) { seen.add(key); problems.push(`${name}.${m}: [${code}] ${(e.parent && e.parent.message) || e.message}`.slice(0, 230)); }
					}
				} else if (e && e.message === "TIMEOUT") problems.push(`${name}.${m}: TIMEOUT`);
			}
		}
	}
}
console.log(`repositories ${Object.keys(repos).length} | methods ${methods} | calls ${calls} | database-level errors seen ${dbErrors} (data-rule errors from made-up arguments are expected)`);
console.log(problems.length ? "POSSIBLE PROBLEMS:\n" + problems.join("\n") : "no SQL syntax / column / type problems found");
const c = (await load("database/connection.js")).default;
await c.close();
await dropTestSchema(schema);
console.log("public:", JSON.stringify(await publicRowTotal()));
process.exit(0);
