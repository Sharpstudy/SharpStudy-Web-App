// The few raw SQL statements that cannot be expressed through Sequelize models, written once per dialect.
// MySQL variants are the original statements (only the time function is injected); PostgreSQL variants use
// INSERT ... ON CONFLICT, which needs the matching unique constraint (created by the PostgreSQL baseline migration).
import { isPostgres, utcNowSql } from "./dialect.js";

// Atomic increment keyed on (learner_id, local_date).  Replacements: id, learnerId, date, w, s, sec
export function addActivitySql(dialect) {
	const now = utcNowSql(dialect);
	if (isPostgres(dialect)) {
		return `INSERT INTO ml_daily_activity (id, learner_id, local_date, worksheets, stars, seconds, created_at, updated_at)
			 VALUES (:id, :learnerId, :date, :w, :s, :sec, ${now}, ${now})
			 ON CONFLICT (learner_id, local_date) DO UPDATE SET worksheets = ml_daily_activity.worksheets + :w, stars = ml_daily_activity.stars + :s, seconds = ml_daily_activity.seconds + :sec, updated_at = ${now}`;
	}
	return `INSERT INTO ml_daily_activity (id, learner_id, local_date, worksheets, stars, seconds, created_at, updated_at)
			 VALUES (:id, :learnerId, :date, :w, :s, :sec, ${now}, ${now})
			 ON DUPLICATE KEY UPDATE worksheets = worksheets + :w, stars = stars + :s, seconds = seconds + :sec, updated_at = ${now}`;
}

// Presence heartbeat keyed on (kind, subject_id).  Replacements: id, kind, subjectId, path
export function touchPresenceSql(dialect) {
	const now = utcNowSql(dialect);
	if (isPostgres(dialect)) {
		return `INSERT INTO ml_presence (id, kind, subject_id, path, last_seen_at, created_at, updated_at)
			 VALUES (:id, :kind, :subjectId, :path, ${now}, ${now}, ${now})
			 ON CONFLICT (kind, subject_id) DO UPDATE SET path = :path, last_seen_at = ${now}, updated_at = ${now}`;
	}
	return `INSERT INTO ml_presence (id, kind, subject_id, path, last_seen_at, created_at, updated_at)
			 VALUES (:id, :kind, :subjectId, :path, ${now}, ${now}, ${now})
			 ON DUPLICATE KEY UPDATE path = :path, last_seen_at = ${now}, updated_at = ${now}`;
}

// Makes sure the single lock row exists (never overwrites it).
export function ensureScheduleLockRowSql(dialect) {
	return isPostgres(dialect)
		? "INSERT INTO meeting_schedule_lock (id) VALUES (1) ON CONFLICT DO NOTHING"
		: "INSERT IGNORE INTO meeting_schedule_lock (id) VALUES (1)";
}
