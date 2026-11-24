'use strict';
// PostgreSQL: Free Demo Class requests are stored in the existing `meeting_requests` table (no new table).
// ADDITIVE and REVERSIBLE:
//   * seven new columns (all nullable except `kind`, which defaults to 'meeting', so every existing row stays a normal meeting request);
//   * `email`, `requested_date`, `requested_time` and `requested_at` stop being NOT NULL, because a demo request may omit them.
//     A CHECK constraint keeps ordinary meeting requests exactly as strict as before: kind = 'meeting' still requires all four;
//   * a second CHECK requires child name, grade and program for kind = 'free_demo';
//   * three indexes for the admin filters.
// Nothing existing is dropped or rewritten. IF NOT EXISTS / guarded blocks make it safe to run twice. down() refuses to run while any
// free-demo row exists (dropping the columns would lose that data) and otherwise restores the original NOT NULL rules.
//
// Plain SQL with UNQUALIFIED names on purpose (applies to the first schema on the connection's search_path), like the migrations before it.
const CHECKS = [
	['ck_meeting_requests_kind', `CHECK ("kind" IN ('meeting', 'free_demo'))`],
	['ck_meeting_requests_class_mode', `CHECK ("class_mode" IS NULL OR "class_mode" IN ('online', 'offline'))`],
	['ck_meeting_requests_meeting_required', `CHECK ("kind" <> 'meeting' OR ("email" IS NOT NULL AND "requested_date" IS NOT NULL AND "requested_time" IS NOT NULL AND "requested_at" IS NOT NULL))`],
	['ck_meeting_requests_demo_required', `CHECK ("kind" <> 'free_demo' OR ("child_name" IS NOT NULL AND "child_grade" IS NOT NULL AND "program" IS NOT NULL))`],
];
const INDEXES = [
	['idx_meeting_requests_kind_created', '("kind", "created_at")'],
	['idx_meeting_requests_program', '("program")'],
	['idx_meeting_requests_source', '("source")'],
];

module.exports = {
	async up(queryInterface) {
		const sequelize = queryInterface.sequelize;
		if (sequelize.getDialect() !== 'postgres') throw new Error('PostgreSQL only');
		await sequelize.transaction(async (transaction) => {
			const run = (sql) => sequelize.query(sql, { transaction });
			const [[t]] = await sequelize.query("SELECT to_regclass('meeting_requests') AS t", { transaction });
			if (!t) throw new Error('table "meeting_requests" is not on the current search_path: nothing was changed');
			await run(`ALTER TABLE "meeting_requests"
				ADD COLUMN IF NOT EXISTS "kind" varchar(16) NOT NULL DEFAULT 'meeting',
				ADD COLUMN IF NOT EXISTS "child_name" varchar(120),
				ADD COLUMN IF NOT EXISTS "child_grade" varchar(40),
				ADD COLUMN IF NOT EXISTS "program" varchar(40),
				ADD COLUMN IF NOT EXISTS "source" varchar(40),
				ADD COLUMN IF NOT EXISTS "source_page" varchar(160),
				ADD COLUMN IF NOT EXISTS "class_mode" varchar(16)`);
			// Checks first, so the relaxed columns can never be NULL on an ordinary meeting request.
			for (const [name, def] of CHECKS) {
				await run(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}' AND conrelid = to_regclass('meeting_requests')) THEN ALTER TABLE "meeting_requests" ADD CONSTRAINT "${name}" ${def}; END IF; END $$`);
			}
			await run(`ALTER TABLE "meeting_requests" ALTER COLUMN "email" DROP NOT NULL, ALTER COLUMN "requested_date" DROP NOT NULL, ALTER COLUMN "requested_time" DROP NOT NULL, ALTER COLUMN "requested_at" DROP NOT NULL`);
			for (const [name, cols] of INDEXES) await run(`CREATE INDEX IF NOT EXISTS "${name}" ON "meeting_requests" ${cols}`);
		});
	},

	async down(queryInterface) {
		const sequelize = queryInterface.sequelize;
		await sequelize.transaction(async (transaction) => {
			const run = (sql) => sequelize.query(sql, { transaction });
			const [[c]] = await sequelize.query(`SELECT count(*)::int AS n FROM "meeting_requests" WHERE "kind" = 'free_demo'`, { transaction });
			if (c.n > 0) throw new Error(`${c.n} free-demo request(s) exist; rolling back would delete their data. Export or remove them first. Nothing was changed.`);
			for (const [name] of INDEXES) await run(`DROP INDEX IF EXISTS "${name}"`);
			await run(`ALTER TABLE "meeting_requests" ALTER COLUMN "email" SET NOT NULL, ALTER COLUMN "requested_date" SET NOT NULL, ALTER COLUMN "requested_time" SET NOT NULL, ALTER COLUMN "requested_at" SET NOT NULL`);
			for (const [name] of [...CHECKS].reverse()) await run(`ALTER TABLE "meeting_requests" DROP CONSTRAINT IF EXISTS "${name}"`);
			await run(`ALTER TABLE "meeting_requests" DROP COLUMN IF EXISTS "class_mode", DROP COLUMN IF EXISTS "source_page", DROP COLUMN IF EXISTS "source", DROP COLUMN IF EXISTS "program", DROP COLUMN IF EXISTS "child_grade", DROP COLUMN IF EXISTS "child_name", DROP COLUMN IF EXISTS "kind"`);
		});
	},
};
