import { Answer_Option, Quiz, Question } from "database/models";
import { requireUser, TEACHER_ROLES } from "@/lib/auth/access";

export default async function handler(req, res) {
  // 401 invalid/missing token, 403 wrong role; identity and role come from the database.
  const actor = await requireUser(req, res, TEACHER_ROLES);
  if (!actor) return;
  req.actor = actor;
  switch (req.method) {
    case "GET":
      await handleGetRequest(req, res);
      break;
    default:
      res.status(405).json({
        message: `Method ${req.method} not allowed`,
      });
  }
}

const handleGetRequest = async (req, res) => {
  try {
    const user = req.actor;
    if (user.role === 'student') {
      return res.status(401).json({ message: "User is not authorized" });
    }
    const quizzes = await Quiz.findAll({
      order: [["created_at", "DESC"]],
      include: [
        {
          model: Question,
          as: 'questions',
          attributes: ['id', 'quizId', 'question_text'],
          include: [
            {
              model: Answer_Option,
              as: 'answer_options',
              attributes: ['id', 'questionId', 'option_text']
            }
          ]
        }
      ],
      where: { userId: user.userId },
    });

    res.status(200).json({ quizzes });
  } catch (e) {
    res.status(400).json({
      error_code: "get_quizzes",
      message: e.message,
    });
  }
};