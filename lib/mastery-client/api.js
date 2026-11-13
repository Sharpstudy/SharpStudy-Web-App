// Browser-side helpers for /api/mastery. Sends the existing login token
// (cookie edmy_users_token) and, when a learner profile is unlocked, the
// learner session token.
import axios from "axios";
import cookie from "js-cookie";
import { safeStorage } from "./storage";

const LEARNER_TOKEN_KEY = "ss.learnerToken";

const ACTIVE_LEARNER_KEY = "ss.activeLearner";

export const getLearnerToken = () => safeStorage.get(LEARNER_TOKEN_KEY);
export const getActiveLearner = () => safeStorage.getJSON(ACTIVE_LEARNER_KEY, null);
// Stores the learner session token plus the public profile (used offline).
// `accountUserId` records which signed-in account unlocked the profile, so a profile left by
// a previous login is never reused under another account.
export const setLearnerToken = (t, learner, accountUserId) => {
	if (t) {
		safeStorage.set(LEARNER_TOKEN_KEY, t);
		if (learner) safeStorage.setJSON(ACTIVE_LEARNER_KEY, { id: learner.id, displayName: learner.displayName, avatar: learner.avatar, accountUserId: accountUserId || null });
	} else {
		safeStorage.remove(LEARNER_TOKEN_KEY);
		safeStorage.remove(ACTIVE_LEARNER_KEY);
	}
};

// Forget the unlocked learner (logout, login, account change).
export const clearLearnerSession = () => setLearnerToken(null);

export function headers({ learner = true, account = true } = {}) {
	const h = {};
	const acct = cookie.get("edmy_users_token");
	if (account && acct) h.Authorization = acct;
	const lt = learner ? getLearnerToken() : null;
	if (lt) h["x-learner-token"] = lt;
	return h;
}

// Normalised error: { status, code, message, data }
export function apiError(err) {
	const r = err && err.response;
	if (!r) return { status: 0, code: "network", message: "You appear to be offline. Check your connection and try again." };
	const d = r.data || {};
	return { status: r.status, code: d.code || "error", message: d.message || "Something went wrong.", data: d };
}

// next.config.js sets trailingSlash: true; add it here to skip a 308 hop.
const withSlash = (url) => {
	const [path, query] = url.split("?");
	return `/api/mastery${path.endsWith("/") ? path : `${path}/`}${query ? `?${query}` : ""}`;
};

async function call(method, url, data, opts = {}) {
	try {
		const res = await axios({ method, url: withSlash(url), data, headers: headers(opts), timeout: opts.timeout || 20000 });
		return res.data;
	} catch (e) {
		throw apiError(e);
	}
}

export const api = {
	get: (url, opts) => call("get", url, undefined, opts),
	post: (url, data, opts) => call("post", url, data, opts),
	patch: (url, data, opts) => call("patch", url, data, opts),
	put: (url, data, opts) => call("put", url, data, opts),
	del: (url, data, opts) => call("delete", url, data, opts),
};
