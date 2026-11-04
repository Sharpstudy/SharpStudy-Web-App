// Return-to-page after sign-in / registration. The destination travels in `?next=`, which anyone can
// edit, so only same-site relative paths are ever followed (never another origin, never a script).

// -> a safe relative path ("/books/my-book/checkout/") or null.
export function safeNextPath(next) {
	if (Array.isArray(next)) next = next[0];
	if (typeof next !== "string") return null;
	const s = next.trim();
	if (!s || s.length > 300) return null;
	if (!s.startsWith("/") || s.startsWith("//") || s.includes("\\")) return null;
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u001f\u007f]/.test(s)) return null;
	if (/^\/+[a-z][a-z0-9+.-]*:/i.test(s)) return null;
	return s;
}

// The sign-in / registration page that returns to `path` afterwards.
export const authUrlFor = (path) => {
	const safe = safeNextPath(path);
	return safe ? `/auth/?next=${encodeURIComponent(safe)}` : "/auth/";
};

export const bookCheckoutPath = (slug) => `/books/${encodeURIComponent(slug)}/checkout/`;
