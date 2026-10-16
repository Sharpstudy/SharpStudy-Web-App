import fs from "fs";
import { requireRole } from "@/lib/auth/requireRole";
let siteSettings = require("../../public/settings.json");

export default async function handler(req, res) {
	if (req.method !== "POST") {
		return res.status(405).json({ message: `Method ${req.method} not allowed` });
	}
	// This rewrites public/settings.json (the homepage pop-up), so it is admin-only.
	if (!(await requireRole(req, res, ["admin"]))) return;
	const { site, image_url } = req.body || {};
	if (image_url !== undefined && image_url !== null && image_url !== "" && !(typeof image_url === "string" && /^https:\/\/[^\s"<>]{1,500}$/.test(image_url))) {
		return res.status(422).json({ message: "image_url must be an https URL" });
	}
	if (!image_url && typeof site !== "boolean") {
		return res.status(422).json({ message: "site must be true or false" });
	}

	try {
		if (image_url) {
			siteSettings.siteModalImage = image_url;

			const sss = Object.assign(siteSettings);
			fs.writeFileSync(
				`${process.cwd()}/public/settings.json`,
				JSON.stringify(sss, null, 4)
			);
		} else {
			siteSettings.siteModal = site;

			const sss = Object.assign(siteSettings);
			fs.writeFileSync(
				`${process.cwd()}/public/settings.json`,
				JSON.stringify(sss, null, 4)
			);
		}

		res.status(200).json({ message: "Settings updated" });
	} catch (e) {
		res.status(400).json({
			error_code: "get_my_courses",
			message: e.message,
		});
	}
}
