
import { requireRole } from "@/lib/auth/requireRole";
import Category from "database/models/category";

export default async function handler(req, res) {
	// Listing categories is needed by anyone creating or editing a course
	// (instructors), so any signed-in user may read it. Deleting stays admin-only.
	const allowed = req.method === "GET" ? ["admin", "instructor", "student"] : ["admin"];
	if (!(await requireRole(req, res, allowed))) return;
	switch (req.method) {
		case "GET":
			await handleGet(req, res);
			break;
		case "DELETE":
			await handleDelete(req, res);
			break;
		default:
			res.status(405).json({
				message: `Method ${req.method} not allowed`,
			});
	}
}

const handleGet = async (req, res) => {
	try {
		const categories = await Category.findAll({
			order: [["created_at", "DESC"]],
			limit: 20,
		});

		res.status(200).json({ categories });
	} catch (e) {
		res.status(400).json({
			error_code: "get_categories",
			message: e.message,
		});
	}
};

const handleDelete = async (req, res) => {
	const { catId } = req.query;
	// console.log(catId);
	try {
		const cat = await Category.findOne({
			where: { id: catId },
		});

		cat.destroy();

		res.status(200).json({ message: "Category deleted successfully." });
	} catch (e) {
		res.status(400).json({
			error_code: "get_categories",
			message: e.message,
		});
	}
};
