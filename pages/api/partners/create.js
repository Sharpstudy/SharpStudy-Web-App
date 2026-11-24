import Partner from "database/models/partner";
import { requireRole } from "@/lib/auth/requireRole";

export default async function handler(req, res) {
	// Creating/removing partners is an admin action (the public list is GET /api/partners).
	if (!(await requireRole(req, res, ["admin"]))) return;
	switch (req.method) {
		case "POST":
			await createPartner(req, res);
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

const createPartner = async (req, res) => {
	const { name, partner_image } = req.body;

	try {
		const newcreatePartner = await Partner.create({
			name,
			partner_image,
		});

		res.status(200).json({
			message: "New Partner added",
			partner: newcreatePartner,
		});
	} catch (e) {
		res.status(400).json({
			error_code: "create_partner",
			message: e.message,
		});
	}
};

const handleDelete = async (req, res) => {
	const { partnerId } = req.query;
	try {
		const partner = await Partner.findOne({
			where: { id: partnerId },
		});

		await partner.destroy();

		res.status(200).json({ message: "Partner deleted successfully." });
	} catch (e) {
		res.status(400).json({
			error_code: "delete_partner",
			message: e.message,
		});
	}
};
