// Idempotent creation of the 21 fictional demo books.
//
//  * Identity is the stable slug. A slug that already exists is NEVER touched - whether it is a demo book an
//    administrator has since edited, or a real product that happens to use the slug - so re-running is safe and
//    nothing is overwritten or deleted.
//  * Only inserts; never updates or deletes rows.
//  * Each new book gets an original sample PDF and a short public preview written to private storage.
//
// Pure with respect to storage and the database: `repo` and `storage` are passed in (see
// scripts/books/seed-demo.mjs for the development-only command line entry point).
import { DEMO_BOOKS, DEMO_PUBLISHER, DEMO_YEAR } from "./demoData.js";
import { demoBookPdf, demoPreviewPdf } from "./demoPdf.js";

export const demoCoverPath = (slug) => `/images/books/demo/${slug}.svg`;

export async function seedDemo({ repo, storage, now = new Date(), log = () => {} }) {
	const result = { created: [], skipped: [], conflicts: [] };
	for (const b of DEMO_BOOKS) {
		const existing = await repo.getBookBySlug(b.slug);
		if (existing) {
			(existing.is_demo ? result.skipped : result.conflicts).push(b.slug);
			log(existing.is_demo ? `skip      ${b.slug} (already seeded; left as is)` : `CONFLICT  ${b.slug} (used by a non-demo book; not touched)`);
			continue;
		}
		const file = demoBookPdf(b);
		const preview = demoPreviewPdf(b);
		const filePath = await storage.put("files", "pdf", file);
		let previewPath = null;
		try {
			previewPath = await storage.put("files", "pdf", preview);
			await repo.insertBook({
				slug: b.slug,
				title: b.title,
				author: b.author,
				description: b.description,
				category: b.category,
				subject: b.subject,
				language: b.language,
				price_cents: b.priceRupees * 100,
				publisher: DEMO_PUBLISHER,
				published_year: DEMO_YEAR,
				isbn: null,
				status: "published",
				featured: !!b.featured,
				published_at: now,
				file_path: filePath,
				file_mime: "application/pdf",
				file_size: file.length,
				preview_path: previewPath,
				cover_url: demoCoverPath(b.slug),
				age_group: b.ageGroup,
				min_age: b.minAge,
				max_age: b.maxAge,
				grade_min: b.gradeMin,
				grade_max: b.gradeMax,
				reading_level: b.readingLevel,
				tags: b.tags,
				is_demo: true,
				created_at: now,
				updated_at: now,
			});
		} catch (e) {
			// Never leave orphaned files behind if the row could not be written.
			await storage.remove(filePath).catch(() => {});
			if (previewPath) await storage.remove(previewPath).catch(() => {});
			throw e;
		}
		result.created.push(b.slug);
		log(`created   ${b.slug}`);
	}
	return result;
}
