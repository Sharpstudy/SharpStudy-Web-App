import { verifyUser } from "@/utils/auth";
import { Answer_Option, Quiz, Question } from "database/models";

export default async function handler(req, res) {
  if (!("authorization" in req.headers)) {
    return res.status(401).json({ message: "No autorization token" });
  }
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
    const user = await verifyUser(req, res);
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