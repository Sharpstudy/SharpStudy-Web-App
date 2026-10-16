'use strict';
// Mastery Ladder defaults. Idempotent: rows are only inserted when missing,
// so re-running never overwrites settings an admin has changed.
const { randomUUID } = require("crypto");

const SETTINGS = {
	"tutor.enabled": true,
	"tutor.chatEnabled": false,
	"tutor.model": "claude-opus-5-5",
	"tutor.maxRequestsPerHour": 60,
};

const ROLES = [
	{
		name: "Family",
		description: "Parent/guardian accounts: can create and manage their own learner profiles.",
		permissions: ["learners.create"],
	},
	{
		name: "Support",
		description: "Helps families: can view and manage learners and read feedback.",
		permissions: ["admin.access", "learners.manage_all", "feedback.manage"],
	},
	{
		name: "Auditor",
		description: "Read-only access to the audit log.",
		permissions: ["admin.access", "audit.view"],
	},
];

module.exports = {
	async up(queryInterface) {
		const now = new Date();
		const [existingSettings] = await queryInterface.sequelize.query("SELECT `key` FROM ml_settings");
		const haveKeys = new Set(existingSettings.map((r) => r.key));
		const settingRows = Object.entries(SETTINGS)
			.filter(([k]) => !haveKeys.has(k))
			.map(([key, value]) => ({ key, value: JSON.stringify(value), created_at: now, updated_at: now }));
		if (settingRows.length) await queryInterface.bulkInsert("ml_settings", settingRows);

		const [existingRoles] = await queryInterface.sequelize.query("SELECT name FROM ml_roles");
		const haveRoles = new Set(existingRoles.map((r) => r.name));
		const roleRows = ROLES.filter((r) => !haveRoles.has(r.name)).map((r) => ({
			id: randomUUID(),
			name: r.name,
			description: r.description,
			permissions: JSON.stringify(r.permissions),
			created_at: now,
			updated_at: now,
		}));
		if (roleRows.length) await queryInterface.bulkInsert("ml_roles", roleRows);

		// The Family role is created but never auto-assigned: an administrator grants
		// it to specific accounts (Admin > Mastery Ladder > Users & roles).
	},

	async down(queryInterface, Sequelize) {
		await queryInterface.bulkDelete("ml_roles", { name: { [Sequelize.Op.in]: ROLES.map((r) => r.name) } });
		await queryInterface.bulkDelete("ml_settings", { key: { [Sequelize.Op.in]: Object.keys(SETTINGS) } });
	},
};
