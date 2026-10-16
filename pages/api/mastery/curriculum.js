import { apiHandler } from "@/lib/mastery-server/http";
import { curriculumSummary } from "@/lib/mastery/curriculum";
import { RULES } from "@/lib/mastery/rules";

// Public, answer-free curriculum structure.
export default apiHandler({
	GET: async (req, res) => {
		res.status(200).json({ subjects: curriculumSummary(), rules: RULES });
	},
});
