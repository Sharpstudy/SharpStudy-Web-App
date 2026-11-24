import { requireUser } from "@/lib/auth/access";
import { Enrolment, Course, User } from "@/database/models";

export default async function handler(req, res) {
  // 401 for a missing/invalid token (verified, not just present)
  const actor = await requireUser(req, res);
	if (!actor) return;
  switch (req.method) {
    case "GET":
      await handleGetRequest(req, res, actor);
      break;
    default:
      res.status(405).json({
        message: `Method ${req.method} not allowed`,
      });
  }
}

const handleGetRequest = async (req, res, actor) => {
  try {
    const userId = actor.userId;

    const enrolments = await Enrolment.findAll({
      order: [["created_at", "DESC"]],
      where: { userId: userId },
      include: [
        {
          model: Course,
          as: "course",
          attributes: [
            "title",
            "slug",
            "duration",
            "lessons",
            "image",
            "access_time",
          ],
          include: [
            {
              model: User,
              as: "user",
              attributes: ["first_name", "last_name"],
            },
          ],
        },
      ],
    });

    res.status(200).json({
      enrolments,
    });
  } catch (e) {
    res.status(400).json({
      error_code: "progress",
      message: e.message,
    });
  }
};
