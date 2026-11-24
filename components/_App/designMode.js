// Which visual mode a route uses. "pro" = instructor and admin work (restrained); everything else
// (public site, books, courses, student learning, Mastery Ladder, family) is the playful "play" mode.
const PRO_PREFIXES = ["/admin", "/instructor", "/telecaller"];

export const designMode = (pathname = "") => (PRO_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/")) ? "pro" : "play");
