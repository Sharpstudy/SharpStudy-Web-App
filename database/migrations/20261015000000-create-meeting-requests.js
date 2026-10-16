'use strict';
// "Schedule a call" requests and their audit trail. Additive only: creates two
// new tables and touches nothing else. Timestamps are stored in UTC; the
// visitor's chosen date/time/zone are kept as entered AND as a UTC instant
// (requested_at) so overlap checks and sorting are reliable.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
	async up(queryInterface, Sequelize) {
		const { UUID, UUIDV4, STRING, INTEGER, DATE, DATEONLY, TEXT, ENUM, CHAR } = Sequelize;
		const timestamps = {
			created_at: { allowNull: false, type: DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
			updated_at: { allowNull: false, type: DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
		};

		await queryInterface.createTable("meeting_requests", {
			id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
			reference: { type: STRING(20), allowNull: false, unique: true }, // shown to the visitor, e.g. MTG-7K3QX9PD
			// Hash of the secret in the visitor's status link; lets only that visitor view/cancel/accept.
			manage_token_hash: { type: CHAR(64), allowNull: false },
			// Client-generated id for the submit button: a repeated POST returns the same request.
			submission_key: { type: STRING(64), unique: true },

			name: { type: STRING(120), allowNull: false },
			email: { type: STRING(200), allowNull: false },
			phone: { type: STRING(40), allowNull: false },
			organization: { type: STRING(160) },
			purpose: { type: ENUM("product_demo", "course_inquiry", "partnership", "technical_support", "other"), allowNull: false },
			message: { type: TEXT },

			requested_date: { type: DATEONLY, allowNull: false }, // as entered by the visitor
			requested_time: { type: CHAR(5), allowNull: false }, // HH:MM, as entered
			time_zone: { type: STRING(64), allowNull: false }, // IANA zone of the entered date/time
			requested_at: { type: DATE, allowNull: false }, // the same moment in UTC

			status: { type: ENUM("pending", "approved", "rejected", "reschedule_requested", "cancelled"), allowNull: false, defaultValue: "pending" },
			duration_minutes: { type: INTEGER, allowNull: false, defaultValue: 30 },
			// Confirmed slot (status approved). Overlaps between approved meetings are refused by the service.
			confirmed_start: { type: DATE },
			confirmed_end: { type: DATE },
			// Slot proposed by an admin (status reschedule_requested).
			proposed_start: { type: DATE },
			meeting_url: { type: STRING(500) },
			admin_notes: { type: TEXT }, // private: never returned to the visitor

			processed_by: { type: UUID, allowNull: true, onDelete: "SET NULL", references: { model: "users", key: "id" } },
			processed_at: { type: DATE },
			version: { type: INTEGER, allowNull: false, defaultValue: 0 }, // optimistic concurrency

			// E-mail delivery bookkeeping, so a failed send is visible and can be retried.
			admin_email_status: { type: ENUM("pending", "sent", "failed", "skipped"), allowNull: false, defaultValue: "pending" },
			visitor_email_status: { type: ENUM("pending", "sent", "failed", "skipped"), allowNull: false, defaultValue: "pending" },
			last_email_error: { type: STRING(300) },
			...timestamps,
		});
		await queryInterface.addIndex("meeting_requests", ["status", "created_at"]);
		await queryInterface.addIndex("meeting_requests", ["email", "created_at"]);
		await queryInterface.addIndex("meeting_requests", ["confirmed_start", "confirmed_end"]);
		await queryInterface.addIndex("meeting_requests", ["requested_at"]);

		await queryInterface.createTable("meeting_request_events", {
			id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
			meeting_request_id: { type: UUID, allowNull: false, onDelete: "CASCADE", references: { model: "meeting_requests", key: "id" } },
			from_status: { type: STRING(24) },
			to_status: { type: STRING(24), allowNull: false },
			actor: { type: STRING(20), allowNull: false }, // admin | visitor | system
			actor_user_id: { type: UUID, allowNull: true, onDelete: "SET NULL", references: { model: "users", key: "id" } },
			note: { type: STRING(500) },
			...timestamps,
		});
		await queryInterface.addIndex("meeting_request_events", ["meeting_request_id", "created_at"]);
	},

	async down(queryInterface) {
		await queryInterface.dropTable("meeting_request_events");
		await queryInterface.dropTable("meeting_requests");
	},
};
