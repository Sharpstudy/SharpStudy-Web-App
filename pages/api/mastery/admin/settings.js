import { apiHandler, getAccountActor, repo, body, clientIp } from "@/lib/mastery-server/http";
import { getTutorSettings, updateTutorSettings, requirePermission } from "@/lib/mastery/service";
import { PERMISSIONS } from "@/lib/mastery/policy";
import { TUTOR_MODELS } from "@/lib/mastery/tutor";
import { tutorAiConfigured } from "@/lib/mastery-server/ai";

// Sage tutor configuration. Reports whether a key is configured, never the key.
export default apiHandler({
	GET: async (req, res) => {
		const actor = await getAccountActor(req);
		requirePermission(actor, PERMISSIONS.TUTOR_CONFIGURE);
		res.status(200).json({ settings: await getTutorSettings(repo), models: TUTOR_MODELS, apiKeyConfigured: tutorAiConfigured() });
	},
	PUT: async (req, res) => {
		const actor = await getAccountActor(req);
		res.status(200).json({ settings: await updateTutorSettings(repo, actor, body(req), { ip: clientIp(req) }), apiKeyConfigured: tutorAiConfigured() });
	},
});
