// In-memory credentials repository with the same semantics as lib/auth/credentialsRepo.js (no database, nothing persisted).
export const USER = (n, extra = {}) => ({
	id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
	first_name: `User${n}`, last_name: "Test", email: `u${n}@example.test`, role: "student", status: true,
	email_confirmed: true, password: `hash:pw${n}Pass`, google_sub: null,
	password_reset_token_hash: null, password_reset_expires_at: null, password_reset_requested_at: null, password_changed_at: null, failed_login_count: 0, locked_until: null,
	...extra,
});

export function credentialsRepo(users = []) {
	const rows = users.map((u) => ({ ...u }));
	const by = (f) => rows.find(f) || null;
	const copy = (u) => (u ? { ...u } : null);
	return {
		rows,
		async findByEmail(e) { return copy(by((u) => u.email.toLowerCase() === String(e).toLowerCase())); },
		async findById(id) { return copy(by((u) => u.id === id)); },
		async findByGoogleSub(s) { return s ? copy(by((u) => u.google_sub === s)) : null; },
		async findByResetHash(h) { return h ? copy(by((u) => u.password_reset_token_hash === h)) : null; },
		async setResetToken(id, { hash, expiresAt, requestedAt }) { Object.assign(by((u) => u.id === id), { password_reset_token_hash: hash, password_reset_expires_at: expiresAt, password_reset_requested_at: requestedAt }); },
		async consumeReset(hash, { now, passwordHash }) {
			const u = by((x) => x.password_reset_token_hash === hash && x.password_reset_expires_at && new Date(x.password_reset_expires_at) > now);
			if (!u) return false;
			Object.assign(u, { password: passwordHash, password_reset_token_hash: null, password_reset_expires_at: null, password_changed_at: now, failed_login_count: 0, locked_until: null });
			return true;
		},
		async lockedUntil(id) { return (by((u) => u.id === id) || {}).locked_until || null; },
		async recordFailure(id, { now, max, lockMs }) {
			const u = by((x) => x.id === id); if (!u) return;
			const expired = u.locked_until && new Date(u.locked_until) <= now;
			const count = (expired ? 0 : u.failed_login_count) + 1;
			u.failed_login_count = count;
			if (count >= max) { u.locked_until = new Date(now.getTime() + lockMs); u.failed_login_count = 0; }
		},
		async recordSuccess(id) { const u = by((x) => x.id === id); if (u) { u.failed_login_count = 0; u.locked_until = null; } },
		async passwordChangedAt(id) { return (by((u) => u.id === id) || {}).password_changed_at || null; },
		async linkGoogle(id, { sub }) { const u = by((x) => x.id === id && x.google_sub === null); if (!u) return false; u.google_sub = sub; return true; },
		async confirmEmail(id, now) { const u = by((x) => x.id === id); u.email_confirmed = true; if (!u.email_confirmed_at) u.email_confirmed_at = now; },
		async createGoogleUser(row) {
			if (rows.some((u) => u.email.toLowerCase() === row.email.toLowerCase())) return null;
			const u = USER(900 + rows.length, { role: "student", ...row }); rows.push(u); return copy(u);
		},
	};
}
