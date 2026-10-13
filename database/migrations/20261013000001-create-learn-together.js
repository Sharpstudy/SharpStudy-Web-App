"use strict";
// Learn Together: additive tables only (all prefixed lt_). Does not alter any existing table.
// Rollback drops exactly these tables in reverse dependency order.

const TABLES_IN_DROP_ORDER = [
	"lt_rate_limits",
	"lt_analytics_events",
	"lt_audit_log",
	"lt_feedback",
	"lt_kit_interest",
	"lt_dismissed_activities",
	"lt_saved_activities",
	"lt_parent_confidence",
	"lt_concept_progress",
	"lt_observations",
	"lt_misconceptions_seen",
	"lt_session_checks",
	"lt_help_signals",
	"lt_child_responses",
	"lt_step_events",
	"lt_session_participants",
	"lt_sessions",
	"lt_session_groups",
	"lt_content_reviews",
	"lt_activity_versions",
	"lt_activities",
	"lt_pairing_requests",
	"lt_child_device_profiles",
	"lt_child_devices",
	"lt_child_profiles",
	"lt_role_assignments",
	"lt_caregiver_invites",
	"lt_family_members",
	"lt_families",
];

module.exports = {
	async up(queryInterface, Sequelize) {
		const id = { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true };
		const ts = {
			created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
			updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
		};
		const fk = (table, onDelete = "CASCADE", allowNull = false) => ({
			type: Sequelize.UUID,
			allowNull,
			references: { model: table, key: "id" },
			onDelete,
			onUpdate: "CASCADE",
		});
		const enumOf = (values, extra = {}) => ({ type: Sequelize.ENUM(...values), ...extra });
		const create = (name, cols) => queryInterface.createTable(name, cols);
		const index = (table, fields, opts = {}) => queryInterface.addIndex(table, fields, opts);

		// ---------- Family, accounts, devices ----------
		await create("lt_families", {
			id,
			name: { type: Sequelize.STRING(80), allowNull: false },
			created_by_user_id: { type: Sequelize.UUID, allowNull: false },
			family_pin_hash: Sequelize.STRING,
			pin_failed_attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
			pin_locked_until: Sequelize.DATE,
			...ts,
		});

		await create("lt_family_members", {
			id,
			family_id: fk("lt_families"),
			user_id: { ...fk("users"), type: Sequelize.UUID },
			role: enumOf(["owner", "caregiver"], { allowNull: false }),
			invited_at: Sequelize.DATE,
			joined_at: Sequelize.DATE,
			...ts,
		});
		await index("lt_family_members", ["family_id", "user_id"], { unique: true });
		await index("lt_family_members", ["user_id"]);

		await create("lt_caregiver_invites", {
			id,
			family_id: fk("lt_families"),
			email: { type: Sequelize.STRING, allowNull: false },
			token_hash: { type: Sequelize.STRING(64), allowNull: false, unique: true },
			invited_by_user_id: { type: Sequelize.UUID, allowNull: false },
			expires_at: { type: Sequelize.DATE, allowNull: false },
			accepted_at: Sequelize.DATE,
			accepted_by_user_id: Sequelize.UUID,
			revoked_at: Sequelize.DATE,
			...ts,
		});

		await create("lt_role_assignments", {
			id,
			user_id: fk("users"),
			role: enumOf(["lt_editor", "lt_reviewer", "lt_admin"], { allowNull: false }),
			granted_by_user_id: Sequelize.UUID,
			...ts,
		});
		await index("lt_role_assignments", ["user_id", "role"], { unique: true });

		await create("lt_child_profiles", {
			id,
			family_id: fk("lt_families"),
			nickname: { type: Sequelize.STRING(40), allowNull: false },
			avatar_key: { type: Sequelize.STRING(40), allowNull: false },
			age_band: enumOf(["6-7", "7-8", "8-9"], { allowNull: false }),
			language: { type: Sequelize.STRING(10), allowNull: false, defaultValue: "en" },
			read_aloud: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
			large_text: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
			reduced_motion: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
			subject_interests: Sequelize.JSON,
			picture_code_hash: Sequelize.STRING,
			picture_code_failed: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
			picture_code_locked_until: Sequelize.DATE,
			...ts,
		});
		await index("lt_child_profiles", ["family_id"]);

		await create("lt_child_devices", {
			id,
			family_id: fk("lt_families"),
			label: { type: Sequelize.STRING(60), allowNull: false },
			device_token_hash: { type: Sequelize.STRING(64), unique: true },
			paired_by_user_id: { type: Sequelize.UUID, allowNull: false },
			paired_at: Sequelize.DATE,
			last_seen_at: Sequelize.DATE,
			revoked_at: Sequelize.DATE,
			...ts,
		});
		await index("lt_child_devices", ["family_id"]);

		await create("lt_child_device_profiles", {
			id,
			child_device_id: fk("lt_child_devices"),
			child_profile_id: fk("lt_child_profiles"),
			...ts,
		});
		await index("lt_child_device_profiles", ["child_device_id", "child_profile_id"], { unique: true });
		await index("lt_child_device_profiles", ["child_profile_id"]);

		await create("lt_pairing_requests", {
			id,
			family_id: fk("lt_families"),
			code_hash: { type: Sequelize.STRING(64), allowNull: false },
			child_profile_ids: { type: Sequelize.JSON, allowNull: false },
			created_by_user_id: { type: Sequelize.UUID, allowNull: false },
			expires_at: { type: Sequelize.DATE, allowNull: false },
			failed_attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
			locked_at: Sequelize.DATE,
			claim_token_hash: Sequelize.STRING(64),
			claimed_at: Sequelize.DATE,
			claimed_device_label: Sequelize.STRING(60),
			approved_at: Sequelize.DATE,
			approved_by_user_id: Sequelize.UUID,
			denied_at: Sequelize.DATE,
			child_device_id: fk("lt_child_devices", "SET NULL", true),
			delivered_at: Sequelize.DATE,
			...ts,
		});
		await index("lt_pairing_requests", ["code_hash"]);
		await index("lt_pairing_requests", ["claim_token_hash"]);

		// ---------- Content ----------
		await create("lt_activities", {
			id,
			slug: { type: Sequelize.STRING(80), allowNull: false, unique: true },
			subject: enumOf(["math", "science"], { allowNull: false }),
			activity_type: { type: Sequelize.STRING(40), allowNull: false },
			tier: enumOf(["free", "paid"], { allowNull: false, defaultValue: "free" }),
			current_published_version_id: Sequelize.UUID,
			status: enumOf(["draft", "published", "retired"], { allowNull: false, defaultValue: "draft" }),
			...ts,
		});

		await create("lt_activity_versions", {
			id,
			activity_id: fk("lt_activities"),
			version: { type: Sequelize.INTEGER, allowNull: false },
			locale: { type: Sequelize.STRING(10), allowNull: false, defaultValue: "en" },
			content: { type: Sequelize.JSON, allowNull: false },
			review_state: enumOf(["draft", "in_review", "approved", "published", "superseded", "rejected"], {
				allowNull: false,
				defaultValue: "draft",
			}),
			created_by: Sequelize.UUID,
			published_at: Sequelize.DATE,
			...ts,
		});
		await index("lt_activity_versions", ["activity_id", "version", "locale"], { unique: true });

		await create("lt_content_reviews", {
			id,
			activity_version_id: fk("lt_activity_versions"),
			review_type: enumOf(["subject", "developmental", "accessibility", "safety", "editorial"], { allowNull: false }),
			reviewer_user_id: Sequelize.UUID,
			decision: enumOf(["requested", "approved", "changes_requested"], { allowNull: false, defaultValue: "requested" }),
			notes: Sequelize.TEXT,
			at: { type: Sequelize.DATE(3), allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP(3)") },
			...ts,
		});
		await index("lt_content_reviews", ["activity_version_id", "review_type"]);

		// ---------- Sessions and live sync ----------
		await create("lt_session_groups", {
			id,
			family_id: fk("lt_families"),
			host_user_id: { type: Sequelize.UUID, allowNull: false },
			activity_version_id: fk("lt_activity_versions", "RESTRICT"),
			mode: enumOf(["connected", "single_device"], { allowNull: false }),
			state: enumOf(["lobby", "active", "paused", "ended"], { allowNull: false, defaultValue: "lobby" }),
			current_step_index: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
			max_step_index: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
			step_count: { type: Sequelize.INTEGER, allowNull: false },
			seq: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
			duration_mode: enumOf(["full", "short"], { allowNull: false, defaultValue: "full" }),
			step_changed_at: Sequelize.DATE(3),
			started_at: Sequelize.DATE,
			ended_at: Sequelize.DATE,
			...ts,
		});
		await index("lt_session_groups", ["family_id", "state"]);

		await create("lt_sessions", {
			id,
			group_id: fk("lt_session_groups"),
			child_profile_id: fk("lt_child_profiles"),
			status: enumOf(["in_progress", "completed", "abandoned"], { allowNull: false, defaultValue: "in_progress" }),
			started_at: Sequelize.DATE,
			completed_at: Sequelize.DATE,
			active_seconds: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
			...ts,
		});
		await index("lt_sessions", ["child_profile_id", "status"]);
		await index("lt_sessions", ["group_id", "child_profile_id"], { unique: true });

		await create("lt_session_participants", {
			id,
			group_id: fk("lt_session_groups"),
			child_profile_id: fk("lt_child_profiles"),
			child_device_id: fk("lt_child_devices", "SET NULL", true),
			joined_at: Sequelize.DATE,
			last_ack_seq: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
			presence: enumOf(["online", "offline"], { allowNull: false, defaultValue: "offline" }),
			last_presence_at: Sequelize.DATE,
			ready_at: Sequelize.DATE,
			...ts,
		});
		await index("lt_session_participants", ["group_id", "child_profile_id"], { unique: true });

		await create("lt_step_events", {
			id,
			session_id: fk("lt_sessions"),
			step_id: { type: Sequelize.STRING(80), allowNull: false },
			step_index: { type: Sequelize.INTEGER, allowNull: false },
			entered_at: { type: Sequelize.DATE(3), allowNull: false },
			exited_at: Sequelize.DATE(3),
			...ts,
		});
		await index("lt_step_events", ["session_id"]);

		await create("lt_child_responses", {
			id,
			session_id: fk("lt_sessions"),
			child_profile_id: fk("lt_child_profiles"),
			child_device_id: fk("lt_child_devices", "SET NULL", true),
			item_key: { type: Sequelize.STRING(80), allowNull: false },
			value: { type: Sequelize.JSON, allowNull: false },
			is_correct: Sequelize.BOOLEAN,
			submitted_at: { type: Sequelize.DATE(3), allowNull: false },
			...ts,
		});
		await index("lt_child_responses", ["session_id"]);

		await create("lt_help_signals", {
			id,
			session_id: fk("lt_sessions"),
			child_profile_id: fk("lt_child_profiles"),
			step_id: { type: Sequelize.STRING(80), allowNull: false },
			raised_at: { type: Sequelize.DATE(3), allowNull: false },
			acknowledged_at: Sequelize.DATE(3),
			...ts,
		});
		await index("lt_help_signals", ["session_id"]);

		await create("lt_session_checks", {
			id,
			session_id: fk("lt_sessions"),
			question_key: enumOf(["near", "transfer"], { allowNull: false }),
			parent_interpretation: enumOf(["clear", "partial", "not_yet"], { allowNull: false }),
			recorded_by_user_id: Sequelize.UUID,
			...ts,
		});
		await index("lt_session_checks", ["session_id", "question_key"], { unique: true });

		await create("lt_misconceptions_seen", {
			id,
			session_id: fk("lt_sessions"),
			child_profile_id: fk("lt_child_profiles"),
			misconception_key: { type: Sequelize.STRING(80), allowNull: false },
			step_id: Sequelize.STRING(80),
			at: { type: Sequelize.DATE(3), allowNull: false },
			...ts,
		});
		await index("lt_misconceptions_seen", ["child_profile_id"]);

		// ---------- Progress and feedback ----------
		await create("lt_observations", {
			id,
			session_id: fk("lt_sessions"),
			child_profile_id: fk("lt_child_profiles"),
			concept_tags: { type: Sequelize.JSON, allowNull: false },
			outcome: enumOf(["understood", "practice_again", "not_sure"], { allowNull: false }),
			parent_note: Sequelize.TEXT,
			recorded_by_user_id: Sequelize.UUID,
			edited_at: Sequelize.DATE,
			deleted_at: Sequelize.DATE,
			...ts,
		});
		await index("lt_observations", ["child_profile_id"]);

		await create("lt_concept_progress", {
			id,
			child_profile_id: fk("lt_child_profiles"),
			concept_tag: { type: Sequelize.STRING(80), allowNull: false },
			status: enumOf(["introduced", "practicing", "confident"], { allowNull: false }),
			status_source: enumOf(["computed", "parent_override"], { allowNull: false, defaultValue: "computed" }),
			override_at: Sequelize.DATE,
			sessions_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
			last_practiced_at: Sequelize.DATE,
			...ts,
		});
		await index("lt_concept_progress", ["child_profile_id", "concept_tag"], { unique: true });

		await create("lt_parent_confidence", {
			id,
			session_id: fk("lt_sessions"),
			user_id: { type: Sequelize.UUID, allowNull: false },
			rating: { type: Sequelize.TINYINT, allowNull: false },
			...ts,
		});

		for (const t of ["lt_saved_activities", "lt_dismissed_activities"]) {
			await create(t, {
				id,
				family_id: fk("lt_families"),
				child_profile_id: fk("lt_child_profiles", "CASCADE", true),
				activity_id: fk("lt_activities"),
				...ts,
			});
			await index(t, ["family_id", "activity_id"]);
		}

		await create("lt_kit_interest", {
			id,
			user_id: { type: Sequelize.UUID, allowNull: false },
			kit_key: { type: Sequelize.STRING(80), allowNull: false },
			activity_id: fk("lt_activities"),
			at: { type: Sequelize.DATE, allowNull: false },
			...ts,
		});

		await create("lt_feedback", {
			id,
			user_id: { type: Sequelize.UUID, allowNull: false },
			activity_version_id: fk("lt_activity_versions"),
			kind: enumOf(["usefulness_rating", "confusion", "safety_concern"], { allowNull: false }),
			rating: Sequelize.TINYINT,
			note: Sequelize.TEXT,
			...ts,
		});
		await index("lt_feedback", ["activity_version_id", "kind"]);

		await create("lt_audit_log", {
			id: { type: Sequelize.BIGINT, autoIncrement: true, primaryKey: true },
			actor_type: enumOf(["user", "child_device", "system"], { allowNull: false }),
			actor_id: Sequelize.STRING(64),
			action: { type: Sequelize.STRING(80), allowNull: false },
			entity_type: { type: Sequelize.STRING(60), allowNull: false },
			entity_id: Sequelize.STRING(64),
			before: Sequelize.JSON,
			after: Sequelize.JSON,
			at: { type: Sequelize.DATE(3), allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP(3)") },
		});
		await index("lt_audit_log", ["entity_type", "entity_id"]);

		await create("lt_analytics_events", {
			id: { type: Sequelize.BIGINT, autoIncrement: true, primaryKey: true },
			name: { type: Sequelize.STRING(60), allowNull: false },
			family_key: Sequelize.STRING(64),
			device_class: Sequelize.STRING(20),
			props: Sequelize.JSON,
			at: { type: Sequelize.DATE(3), allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP(3)") },
		});
		await index("lt_analytics_events", ["name", "at"]);

		await create("lt_rate_limits", {
			key: { type: Sequelize.STRING(191), primaryKey: true },
			window_start: { type: Sequelize.DATE, allowNull: false },
			count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
		});
	},

	async down(queryInterface) {
		for (const t of TABLES_IN_DROP_ORDER) await queryInterface.dropTable(t);
	},
};
