// Gallery content. Plain data so it needs no database, API or upload endpoint.
//
// HOW TO ADD A PHOTO: copy the image into public/gallery/ and add an entry below. An entry is shown ONLY when ALL of these hold
// (see publishableItems): a non-empty `alt` description, a known `category`, an image path under /gallery/, and `consent: true`.
//   consent: true means SharpStudy holds permission to publish the image. For any identifiable student, and always for a minor,
//   that is the parent/guardian's written consent. Never set it to true without that consent.
//
// The list ships EMPTY on purpose: the repository contains no genuine, consented SharpStudy photographs (the images under
// public/images are template artwork, which must not be presented as real SharpStudy students or events).
//
//   { id: "ws-2026-01", src: "/gallery/ws-2026-01.jpg", alt: "Learners building a bridge from paper in a workshop",
//     category: "workshops", caption: "Optional short caption", consent: true }

export const GALLERY_CATEGORIES = [
	{ slug: "workshops", label: "Workshops" },
	{ slug: "classroom-activities", label: "Classroom activities" },
	{ slug: "events", label: "Events" },
	{ slug: "competitions", label: "Competitions" },
	{ slug: "student-projects", label: "Student projects" },
	{ slug: "learning-activities", label: "Learning activities" },
];

export const GALLERY_ITEMS = [];

const slugs = new Set(GALLERY_CATEGORIES.map((c) => c.slug));

export const publishableItems = (items = GALLERY_ITEMS) =>
	items.filter((i) => i && i.consent === true && typeof i.alt === "string" && i.alt.trim() && typeof i.src === "string" && i.src.startsWith("/gallery/") && slugs.has(i.category));

export const filterByCategory = (items, category) => (category ? items.filter((i) => i.category === category) : items);

// Only categories that actually contain a publishable photo are offered as filters.
export const usedCategories = (items) => GALLERY_CATEGORIES.filter((c) => items.some((i) => i.category === c.slug));
