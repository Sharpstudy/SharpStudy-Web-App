import { apiHandler, getAccountActor, repo } from "@/lib/mastery-server/http";
import { loadLearner } from "@/lib/mastery/service";
import { reminderIcs } from "@/lib/mastery/calendar";
import { localDate } from "@/lib/mastery/habits";
import baseUrl from "@/utils/baseUrl";

// Downloadable daily reminder (.ics) for calendar apps.
export default apiHandler({
	GET: async (req, res) => {
		const actor = await getAccountActor(req);
		const { learner } = await loadLearner(repo, actor, req.query.id, "view");
		const ics = reminderIcs({
			learnerId: learner.id,
			learnerName: learner.display_name,
			timeZone: learner.time_zone,
			reminderTime: learner.reminder_time || "16:00",
			startDate: localDate(Date.now(), learner.time_zone),
			dailyGoal: learner.daily_goal,
			url: `${baseUrl}/study/`,
		});
		res.setHeader("Content-Type", "text/calendar; charset=utf-8");
		res.setHeader("Content-Disposition", `attachment; filename="sharpstudy-reminder.ics"`);
		res.status(200).send(ics);
	},
});
