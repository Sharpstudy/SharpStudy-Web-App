// Browser-side helpers for /api/family. Parent calls carry the existing account cookie; child-device
// calls carry only the device secret (and, for unpairing, the short-lived grown-up token).
import axios from "axios";
import cookie from "js-cookie";
import { safeStorage } from "@/lib/mastery-client/storage";
import { apiError, setLearnerToken, clearLearnerSession } from "@/lib/mastery-client/api";

export { apiError };

const DEVICE_KEY = "ss.deviceToken";
export const getDeviceToken = () => safeStorage.get(DEVICE_KEY);
export const setDeviceToken = (t) => (t ? safeStorage.set(DEVICE_KEY, t) : safeStorage.remove(DEVICE_KEY));

// The child's own session on this device (the existing learner token, device-bound).
export { setLearnerToken, clearLearnerSession };

const slash = (u) => {
	const [path, q] = u.split("?");
	return `/api/family${path.endsWith("/") ? path : `${path}/`}${q ? `?${q}` : ""}`;
};

async function call(method, url, data, headers) {
	try {
		const res = await axios({ method, url: slash(url), data, headers, timeout: 20000 });
		return res.data;
	} catch (e) {
		throw apiError(e);
	}
}

const acct = () => {
	const t = cookie.get("edmy_users_token");
	return t ? { Authorization: t } : {};
};

// ---- parent (signed-in account) ----
export const parent = {
	family: () => call("get", "/", undefined, acct()),
	overview: () => call("get", "/overview", undefined, acct()),
	link: (code) => call("post", "/link", { code }, acct()),
	setPicture: (id, picture) => call("patch", `/children/${encodeURIComponent(id)}`, { picture }, acct()),
	setPin: (d) => call("put", "/pin", d, acct()),
	createPairing: (learnerIds) => call("post", "/pairing", { learnerIds }, acct()),
	pairing: (id) => call("get", `/pairing/${encodeURIComponent(id)}`, undefined, acct()),
	cancelPairing: (id) => call("delete", `/pairing/${encodeURIComponent(id)}`, undefined, acct()),
	decide: (id, d) => call("post", `/devices/${encodeURIComponent(id)}`, d, acct()),
	revoke: (id) => call("post", `/devices/${encodeURIComponent(id)}`, { action: "revoke", confirm: true }, acct()),
};

// ---- the child's own signed-in account: show a parent link code ----
export const childLinks = {
	status: () => call("get", "/link/code", undefined, acct()),
	show: () => call("post", "/link/code", {}, acct()),
	cancel: () => call("delete", "/link/code", undefined, acct()),
};

// ---- child device ----
const dev = () => ({ "x-device-token": getDeviceToken() || "" });
export const device = {
	join: (code) => call("post", "/device/join", { code }, {}),
	status: () => call("get", "/device/status", undefined, dev()),
	session: (d) => call("post", "/device/session", d, dev()),
	grownup: (pin) => call("post", "/device/grownup", { pin }, dev()),
	unpair: (grownupToken) => call("post", "/device/unpair", {}, { ...dev(), "x-grownup-token": grownupToken }),
};

// A device the server no longer accepts: forget it and the child's session with it.
export const forgetDevice = () => {
	setDeviceToken(null);
	clearLearnerSession();
};
export const isDeviceGone = (e) => e && e.status === 401 && ["device_invalid", "device_revoked", "device_denied", "device_expired"].includes(e.code);
