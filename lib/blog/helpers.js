// Pure helpers over the existing blog list (utils/sampleData.js blogData). They read the existing articles only.

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// "03 Mar 2018" -> timestamp (NaN when the text is not in that format).
export const parseBlogDate = (text) => {
	const m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/.exec(String(text || "").trim());
	if (!m || !(m[2].toLowerCase() in MONTHS)) return NaN;
	return Date.UTC(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
};

// Newest first; articles with an unreadable date keep their original order after the dated ones.
export const sortNewest = (posts) =>
	[...posts].map((p, i) => ({ p, i, t: parseBlogDate(p.date) })).sort((a, b) => (isNaN(a.t) && isNaN(b.t) ? a.i - b.i : isNaN(a.t) ? 1 : isNaN(b.t) ? -1 : b.t - a.t || a.i - b.i)).map((x) => x.p);

export const featuredPost = (posts) => sortNewest(posts)[0] || null;

export const latestPosts = (posts, n = 3) => sortNewest(posts).slice(0, n);

// Same category first, then the newest others; never the article itself.
export const relatedPosts = (posts, post, n = 3) => {
	const others = sortNewest(posts).filter((p) => p.id !== post.id);
	return [...others.filter((p) => p.category === post.category), ...others.filter((p) => p.category !== post.category)].slice(0, n);
};

export const blogCategories = (posts) => [...new Set(posts.map((p) => p.category))];
