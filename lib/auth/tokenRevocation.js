// Pure: session revocation without a session table. Login tokens are stateless JWTs carrying `iat` (issued-at, seconds). Every
// password change / reset stamps users.password_changed_at; a token issued before that moment is no longer accepted. This signs a
// person out everywhere after a reset, with one extra indexed read, and works across servers.
//
// `changedAt` is a Date / ISO string / null. Compared at whole-second granularity (iat has no finer resolution), so a token issued
// in the same second as the change (the one handed out by the reset itself) stays valid.
export function isTokenRevoked(iatSeconds, changedAt) {
	if (!changedAt) return false;
	const changed = Math.floor(new Date(changedAt).getTime() / 1000);
	if (!Number.isFinite(changed)) return false;
	if (typeof iatSeconds !== "number" || !Number.isFinite(iatSeconds)) return true; // a token with no issue time cannot be proven newer
	return iatSeconds < changed;
}
