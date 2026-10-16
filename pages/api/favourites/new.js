import { Favourite, Course } from "database/models";
import { optionalActor, requireUser } from "@/lib/auth/access";

// Wishlist toggle, always for the signed-in user (userId in the request is ignored).
export default async function handler(req, res) {
	switch (req.method) {
		case "GET":
			await handleGet(req, res);
			break;
		case "POST":
			await handlePost(req, res);
			break;
		default:
			res.status(405).json({
				message: `Method ${req.method} not allowed`,
			});
	}
}

const handleGet = async (req, res) => {
	const { courseId } = req.query;

	try {
		const actor = await optionalActor(req);
		const exist = actor && courseId ? await Favourite.findOne({ where: { userId: actor.userId, courseId } }) : null;
		res.status(200).send(!!exist);
	} catch (e) {
		res.status(400).json({
			error_code: "make_wishlist",
			message: e.message,
		});
	}
};

const handlePost = async (req, res) => {
	const actor = await requireUser(req, res);
	if (!actor) return;
	const { courseId, fav } = req.body;

	try {
		const favexist = await Favourite.findOne({ where: { userId: actor.userId, courseId } });
		if (fav) {
			if (!(await Course.findOne({ where: { id: courseId, approved: true }, attributes: ["id"] }))) {
				return res.status(404).json({ message: "Course not found" });
			}
			if (!favexist) await Favourite.create({ userId: actor.userId, courseId });

			res.status(200).json({
				message: "Added to wishlist",
			});
		} else {
			if (favexist) await favexist.destroy();

			res.status(200).json({
				message: "Remove from wishlist",
			});
		}
	} catch (e) {
		res.status(400).json({
			error_code: "make_wishlist",
			message: e.message,
		});
	}
};
