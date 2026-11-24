import { Course, User, Enrolment, Video, Course_Asset } from "database/models";
import { fn, col, cast } from "sequelize";
import connection from "@/database/connection";
import { isPostgres } from "@/lib/db/dialect";
import { requireRole } from "@/lib/auth/requireRole";

export default async function handler(req, res) {
	// Includes total sales, so it is admin-only (used by the admin dashboard).
	if (!(await requireRole(req, res, ["admin"]))) return;
	try {
		// Independent aggregates, so they run concurrently (one round-trip of latency instead of seven). The earnings total is summed by the
		// database instead of loading every enrolment row into memory (it grew with the business); the value is the same sum of
		// bought_price over all enrolments (NULL counts as 0), computed in double precision.
		const priceColumn = isPostgres(connection) ? cast(col("bought_price"), "double precision") : col("bought_price");
		const [students, instructors, courses, enrolments, earningsRow, videos, assets] = await Promise.all([
			User.count({ where: { role: "student" } }),
			User.count({ where: { role: "instructor" } }),
			Course.count({ where: { approved: true } }),
			Enrolment.count({}),
			Enrolment.findOne({ attributes: [[fn("COALESCE", fn("SUM", priceColumn), 0), "total"]], raw: true }),
			Video.count({}),
			Course_Asset.count({}),
		]);
		const earningsTotal = ((Number(earningsRow && earningsRow.total) * 100) / 100).toFixed(2);

		res.status(200).json({
			students,
			instructors,
			courses,
			enrolments,
			earningsTotal,
			videos,
			assets,
		});
	} catch (e) {
		res.status(400).json({
			error_code: "get_funfacts",
			message: e.message,
		});
	}
}
