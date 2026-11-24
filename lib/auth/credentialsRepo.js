// Sequelize implementation of the repository used by lib/auth/passwordReset.js, lib/auth/signinGuard.js and lib/auth/googleSignin.js
// (same semantics as tests/auth/memoryRepo.mjs). Uses the narrow UserAuth model, so it only touches the columns added by migration
// 20261110000000. Every write that must be atomic is ONE conditional UPDATE (compare-and-set), never read-then-write.
import { Op, UniqueConstraintError } from "sequelize";
import connection from "@/database/connection";
import { ciEquals } from "@/lib/db/dialect";
import UserAuth from "@/database/models/user_auth";

const plain = (row) => (row ? row.get({ plain: true }) : null);

// "The migration has not been applied yet" (a missing column / table) as opposed to a real failure.
export const isMissingSchema = (e) => {
	const m = String((e && (e.parent && e.parent.message ? e.parent.message : e.message)) || "");
	return /unknown column|no such column|does not exist|doesn't exist|undefined column/i.test(m);
};

const repo = {
	async findByEmail(email) {
		return plain(await UserAuth.findOne({ where: ciEquals(connection, "email", email) }));
	},
	async findById(id) {
		return id ? plain(await UserAuth.findByPk(id)) : null;
	},
	async findByGoogleSub(sub) {
		return sub ? plain(await UserAuth.findOne({ where: { google_sub: sub } })) : null;
	},
	async findByResetHash(hash) {
		return hash ? plain(await UserAuth.findOne({ where: { password_reset_token_hash: hash } })) : null;
	},

	// ---- password reset
	async setResetToken(userId, { hash, expiresAt, requestedAt }) {
		await UserAuth.update({ password_reset_token_hash: hash, password_reset_expires_at: expiresAt, password_reset_requested_at: requestedAt }, { where: { id: userId } });
	},
	// Atomic and single-use: succeeds only while the hash is still stored and not expired, and clears it in the same statement.
	// Also signs out every older session (password_changed_at) and clears any sign-in lockout. Returns true when this call won.
	async consumeReset(hash, { now, passwordHash }) {
		const [n] = await UserAuth.update(
			{ password: passwordHash, password_reset_token_hash: null, password_reset_expires_at: null, password_changed_at: now, failed_login_count: 0, locked_until: null },
			{ where: { password_reset_token_hash: hash, password_reset_expires_at: { [Op.gt]: now } } }
		);
		return n === 1;
	},

	// Reaching a reset link proves control of the mailbox, so the reset also confirms the e-mail (keeps an earlier confirmation time).
	async confirmEmail(userId, now) {
		await UserAuth.update({ email_confirmed: true }, { where: { id: userId } });
		await UserAuth.update({ email_confirmed_at: now }, { where: { id: userId, email_confirmed_at: null } });
	},

	// ---- sign-in guard. Tolerant of a missing migration (sign-in must keep working before it is applied: no lockout until then).
	async lockedUntil(userId) {
		try {
			const u = await UserAuth.findByPk(userId, { attributes: ["id", "locked_until"] });
			return u ? u.locked_until || null : null;
		} catch (e) {
			if (isMissingSchema(e)) return null;
			throw e;
		}
	},
	async recordFailure(userId, { now, max, lockMs }) {
		try {
			const u = await UserAuth.findByPk(userId, { attributes: ["id", "failed_login_count", "locked_until"] });
			if (!u) return;
			const lockExpired = u.locked_until && new Date(u.locked_until) <= now;
			const count = (lockExpired ? 0 : u.failed_login_count || 0) + 1;
			const patch = { failed_login_count: count };
			if (count >= max) {
				patch.locked_until = new Date(now.getTime() + lockMs);
				patch.failed_login_count = 0;
			}
			await UserAuth.update(patch, { where: { id: userId } });
		} catch (e) {
			if (!isMissingSchema(e)) throw e;
		}
	},
	async recordSuccess(userId) {
		try {
			await UserAuth.update({ failed_login_count: 0, locked_until: null }, { where: { id: userId, failed_login_count: { [Op.gt]: 0 } } });
		} catch (e) {
			if (!isMissingSchema(e)) throw e;
		}
	},

	// ---- revocation: when did this account's password last change? (null before the migration or when never changed)
	async passwordChangedAt(userId) {
		try {
			const u = await UserAuth.findByPk(userId, { attributes: ["id", "password_changed_at"] });
			return u ? u.password_changed_at || null : null;
		} catch (e) {
			if (isMissingSchema(e)) return null;
			throw e;
		}
	},

	// ---- google
	// Links the Google identity and changes NOTHING else (not the password, not the e-mail confirmation, not the role).
	async linkGoogle(userId, { sub }) {
		const [n] = await UserAuth.update({ google_sub: sub }, { where: { id: userId, google_sub: null } });
		return n === 1;
	},
	// null when the e-mail already exists (a racing sign-in created it first).
	async createGoogleUser(row) {
		try {
			return plain(await UserAuth.create(row));
		} catch (e) {
			if (e instanceof UniqueConstraintError) return null;
			throw e;
		}
	},
};

export default repo;
