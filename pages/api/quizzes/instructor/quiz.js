import { slugify } from "@/utils/auth";
import { requireUser, TEACHER_ROLES, requireCourseManager } from "@/lib/auth/access";
import { Quiz, Question, Answer_Option } from "database/models";

export default async function handler(req, res) {
  // 401 invalid/missing token, 403 wrong role; identity and role come from the database.
  const actor = await requireUser(req, res, TEACHER_ROLES);
  if (!actor) return;
  req.actor = actor;
  switch (req.method) {
    case "POST":
      await handlePostRequest(req, res);
      break;
    case "GET":
      await handleGetRequest(req, res);
      break;
    case "DELETE":
      await handleDeleteRequest(req, res);
      break;
    case "PUT":
      await handlePutRequest(req, res);
      break;
    default:
      res.status(405).json({
        message: `Method ${req.method} not allowed`,
      });
  }
}

const handlePostRequest = async (req, res) => {
  const {
    title,
    description,
    courseId
  } = req.body;
  try {
    const user = req.actor;

    if (user.role === 'student') {
      return res.status(401).json({ message: "User is not authorized to create a quiz" });
    }
    // The course must belong to the caller (or the caller is an admin).
    if (!(await requireCourseManager(res, user, courseId))) return;
    let slug = slugify(title);
    const slugExist = await Quiz.findOne({
      where: { slug: slug },
    });

    if (slugExist) {
      slug = `${slug}-${Math.floor(
        Math.random() * (999 - 100 + 1) + 100
      )}`;
    }

    const newObj = {
      'title': title,
      'slug': slug,
      'description': description,
      'courseId': courseId,
      'userId': user.userId
    };

    const newQuiz = await Quiz.create({
      ...newObj
    });

    res.status(200).json({
      message:
        "Quiz created successfully.",
      quiz: newQuiz,
    });
  } catch (e) {
    res.status(400).json({
      error_code: "create_quiz",
      message: e.message,
    });
  }
};

const handleDeleteRequest = async (req, res) => {
  const { quizId } = req.query;
  try {
    const user = req.actor;

    if (user.role === 'student') {
      return res.status(401).json({ message: "User is not authorized" });
    }

    const quiz = await Quiz.findOne({
      where: { id: quizId },
    });

    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }

    if (user.userId !== quiz.userId) {
      return res.status(403).json({ message: "Unauthorized to delete this quiz" });
    }

    await quiz.destroy({
      include: [
        { model: Question, onDelete: 'cascade' },
        { model: Answer_Option, onDelete: 'cascade' },
      ],
    });

    res.status(200).json({ message: "Quiz and related data deleted successfully" });
  } catch (e) {
    res.status(400).json({
      error_code: "delete_quiz",
      message: e.message,
    });
  }
};

const handleGetRequest = async (req, res) => {
  const { quizId } = req.query;
  try {
    const user = req.actor;

    if (user.role === 'student') {
      return res.status(401).json({ message: "User is not authorized" });
    }

    const quiz = await Quiz.findOne({
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
      where: { id: quizId, userId: user.userId },
    });

    res.status(200).json({ quiz });
  } catch (e) {
    res.status(400).json({
      error_code: "get_quiz",
      message: e.message,
    });
  }
};

const handlePutRequest = async (req, res) => {
  const { quizId } = req.query;
  const {
    title,
    description,
  } = req.body;
  try {
    const user = req.actor;


    if (user.role === 'student') {
      return res.status(401).json({ message: "User is not authorized to update this quiz" });
    }

    const [affectedRows] = await Quiz.update(
      {
        title,
        description,
      },
      {
        where: { id: quizId, userId: user.userId },
      }
    );

    if (affectedRows === 0) {
      return res.status(404).json({
        message: "Quiz not found",
      });
    }

    res.status(200).json({
      message: "Quiz updated successfully",
      updatedQuiz: affectedRows
    });
  } catch (e) {
    res.status(400).json({
      error_code: "update_quiz",
      message: e.message,
    });
  }
};
