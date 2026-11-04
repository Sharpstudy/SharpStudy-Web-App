// Creates the 21 fictional demo books in the DEVELOPMENT database.
//
//   npm run seed:books-demo
//
// Safe by construction:
//   * refuses to run with NODE_ENV=production or on Vercel;
//   * refuses when the development database is the same host + database as the production one;
//   * only INSERTS books that do not exist yet (matched by slug) - existing rows are never updated or deleted;
//   * run it as often as you like: a second run creates nothing.
// Requires the bookstore migration to have been applied (npm run migrate).
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Sequelize from "sequelize";
import config from "../../database/config/config.mjs";
import { seedDemo, demoCoverPath } from "../../lib/books/demoSeed.js";
import { DEMO_BOOKS } from "../../lib/books/demoData.js";
import { demoCoverSvg } from "../../lib/books/demoPdf.js";
import { storageFromEnv } from "../../lib/books/storage.js";

const die = (m) => {
	console.error(`\n${m}\n`);
	process.exit(1);
};

if (process.env.NODE_ENV === "production" || process.env.VERCEL) die("Refusing to seed demo books: this is a production environment. The demo seeder is for development databases only.");
const dev = config.development;
const prod = config.production;
if (!dev.database || !dev.host) die("Development database settings are missing (DB_NAME_DEVELOPMENT / DB_HOSTNAME).");
if (prod.database && dev.database === prod.database && dev.host === prod.host) die(`Refusing to seed: the development database (${dev.database} on ${dev.host}) is the same as the production database.`);

// Covers are plain files under public/ (they are public by design). Written only when missing.
const coverDir = path.resolve("public/images/books/demo");
fs.mkdirSync(coverDir, { recursive: true });
for (const b of DEMO_BOOKS) {
	const file = path.join(coverDir, `${b.slug}.svg`);
	if (!fs.existsSync(file)) fs.writeFileSync(file, demoCoverSvg(b));
}

const sequelize = new Sequelize({ ...dev, logging: false });
const q = (sql, replacements) => sequelize.query(sql, { replacements, type: Sequelize.QueryTypes.SELECT });

try {
	console.log(`Seeding demo books into development database "${dev.database}" on ${dev.host}`);
	await sequelize.authenticate();
	const [table] = await q("SHOW TABLES LIKE 'books'");
	if (!table) die("The books table does not exist. Run the migrations first: npm run migrate");

	const repo = {
		async getBookBySlug(slug) {
			const [row] = await q("SELECT id, slug, is_demo FROM books WHERE slug = ? LIMIT 1", [slug]);
			return row ? { ...row, is_demo: !!row.is_demo } : null;
		},
		async insertBook(b) {
			const cols = Object.keys(b);
			await sequelize.query(`INSERT INTO books (id, ${cols.join(", ")}) VALUES (?, ${cols.map(() => "?").join(", ")})`, {
				replacements: [randomUUID(), ...cols.map((c) => (c === "tags" ? JSON.stringify(b[c]) : b[c]))],
			});
		},
	};
	const result = await seedDemo({ repo, storage: storageFromEnv(), log: (m) => console.log(`  ${m}`) });
	console.log(`\nDone: ${result.created.length} created, ${result.skipped.length} already present, ${result.conflicts.length} slug conflicts.`);
	if (result.conflicts.length) console.log("Conflicting slugs belong to non-demo books and were left untouched.");
	console.log(`Demo covers: ${demoCoverPath("<slug>")}  |  files stored via the "${storageFromEnv().kind}" storage driver.`);
} catch (e) {
	console.error(`\nSeeding failed: ${e.message}`);
	process.exitCode = 1;
} finally {
	await sequelize.close();
}
