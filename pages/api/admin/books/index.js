import { bookHandler, repo, actorFor } from "@/lib/books/http";
import { adminListBooks, adminCreateBook } from "@/lib/books/service";

// Administrator-only. The role is re-read from the database for every request (actorFor), and the
// service refuses anyone who is not an admin, so students and instructors get 403 here.
const one = (v) => (Array.isArray(v) ? v[0] : v);
export default bookHandler({
	GET: async (req, res) => {
		const actor = await actorFor(req);
		const { status, q, demo, category, sort, page, pageSize } = req.query;
		res.status(200).json(await adminListBooks(repo, actor, { status: one(status), q: one(q), demo: one(demo), category: one(category), sort: one(sort), page: one(page), pageSize: one(pageSize) }));
	},
	POST: async (req, res) => {
		const actor = await actorFor(req);
		res.status(201).json(await adminCreateBook(repo, actor, req.body));
	},
});
