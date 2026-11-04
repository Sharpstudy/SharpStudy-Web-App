// localStorage that never throws (private mode, blocked storage, SSR).
export const safeStorage = {
	get(key) {
		try {
			return typeof window === "undefined" ? null : window.localStorage.getItem(key);
		} catch (e) {
			return null;
		}
	},
	set(key, value) {
		try {
			if (typeof window !== "undefined") window.localStorage.setItem(key, value);
			return true;
		} catch (e) {
			return false;
		}
	},
	remove(key) {
		try {
			if (typeof window !== "undefined") window.localStorage.removeItem(key);
		} catch (e) {
			/* ignore */
		}
	},
	getJSON(key, fallback = null) {
		const raw = safeStorage.get(key);
		if (!raw) return fallback;
		try {
			return JSON.parse(raw);
		} catch (e) {
			return fallback;
		}
	},
	setJSON(key, value) {
		return safeStorage.set(key, JSON.stringify(value));
	},
};
