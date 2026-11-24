// An instructor's OWN teaching profile. The user id always comes from the verified token (`actor.userId`); the body can
// never name another account. The repo is injected (see profileRepo.js) so every rule is testable without a database.
//
// Saving is PARTIAL: only fields present in the request are written, so sending just a phone number never blanks the
// biography, links or teaching details. Phone is stored in users.phone, the column the admin screens already read.
import { normalizePhone } from "../phone.js";
import { isAnonymized } from "../admin/anonymized.js";

export class ProfileError extends Error {
	constructor(status, code, message) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

const line = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const block = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r\n?/g, "\n").trim().slice(0, n);
const url = (s) => {
	const v = String(s == null ? "" : s).trim();
	if (!v) return "";
	try {
		const u = new URL(v);
		return u.protocol === "https:" && v.length <= 255 ? u.toString() : null;
	} catch (e) {
		return null;
	}
};
const has = (b, k) => Object.prototype.hasOwnProperty.call(b, k) && b[k] !== undefined;

export async function getOwnProfile(repo, userId) {
	const user = await repo.getUser(userId);
	const p = await repo.getProfile(userId);
	return {
		profile: {
			...(user || {}),
			qualifications: (p && p.qualifications) || "",
			languages: (p && p.languages) || "",
			subjects: (p && p.subjects) || "",
			experience: (p && p.experience) || "",
			phone: (user && user.phone) || "",
		},
	};
}

export async function saveOwnProfile(repo, actor, body) {
	if (isAnonymized({ email: actor.email })) throw new ProfileError(403, "anonymized", "This account has been anonymized and can no longer be edited.");
	const b = body && typeof body === "object" ? body : {};

	// Validate everything first; nothing is written unless the whole request is acceptable.
	const user = {};
	if (has(b, "designation")) user.designation = line(b.designation, 120);
	if (has(b, "bio")) user.bio = block(b.bio, 3000);
	if (has(b, "location")) user.location = line(b.location, 120);
	for (const k of ["website", "linkedin"]) {
		if (!has(b, k)) continue;
		const v = url(b[k]);
		if (v === null) throw new ProfileError(422, "invalid", "Links must be public https:// addresses.");
		user[k] = v;
	}
	if (has(b, "phone")) {
		const r = normalizePhone(b.phone);
		if (!r.ok) throw new ProfileError(422, "invalid_phone", r.error);
		user.phone = r.value; // null clears it
	}
	const profile = {};
	if (has(b, "qualifications")) profile.qualifications = block(b.qualifications, 2000);
	if (has(b, "languages")) profile.languages = line(b.languages, 200);
	if (has(b, "subjects")) profile.subjects = line(b.subjects, 300);
	if (has(b, "experience")) profile.experience = block(b.experience, 3000);

	if (Object.keys(user).length) await repo.updateUser(actor.userId, user);
	// no instructor_profiles row is created unless a teaching-profile field was actually sent
	if (Object.keys(profile).length) await repo.upsertProfile(actor.userId, profile);
	return getOwnProfile(repo, actor.userId);
}
