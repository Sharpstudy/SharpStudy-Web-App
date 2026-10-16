// Server-side page gate used by pages/_app.js (getInitialProps runs on the server for
// the first request of every page). `user` is the database row fetched with the verified
// token, so the role here is never taken from the browser. APIs enforce the same rules
// independently; this keeps the instructor / admin SCREENS from rendering at all for
// people who do not hold the role.
//
// Returns the path to send the visitor to, or null when the page may render.

const under = (pathname, base) => pathname === base || pathname.startsWith(base + "/");

export function pageAccess(pathname, user) {
	const p = String(pathname || "");
	if (under(p, "/admin")) return user && user.role === "admin" ? null : "/";
	if (under(p, "/instructor")) {
		if (user && (user.role === "instructor" || user.role === "admin")) return null;
		// students are pointed at the application, everyone else home
		return user && user.role === "student" ? "/become-an-instructor" : "/";
	}
	return null;
}

export const isGatedPath = (pathname) => under(String(pathname || ""), "/admin") || under(String(pathname || ""), "/instructor");
