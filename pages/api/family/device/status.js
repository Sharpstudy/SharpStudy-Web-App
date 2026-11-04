import { apiHandler, rateLimit } from "@/lib/mastery-server/http";
import { familyRepo, ctxOf, deviceToken } from "@/lib/family/http";
import { deviceStatus } from "@/lib/family/service";

// Polled by the "Ask your grown-up to say yes" screen and the profile picker.
// 401 device_revoked / device_denied / device_expired tell the page to forget the device.
export default apiHandler({
	GET: async (req, res) => {
		if (!rateLimit(req, res, "fam-status", { windowMs: 60000, max: 60 })) return;
		res.status(200).json(await deviceStatus(familyRepo, deviceToken(req), ctxOf(req)));
	},
});
