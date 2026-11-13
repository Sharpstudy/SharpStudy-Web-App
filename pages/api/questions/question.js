import { Quiz, Question, Answer_Option } from "database/models";
import { requireUser, requireQuizOwner, requireQuestionOwner, TEACHER_ROLES } from "@/lib/auth/access";

export default async function handler(req, res) {
  // Only instructors/admins manage questions, and only within quizzes they own.
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
  const questions = req.body
  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ message: "Questions should be a non-empty array" });
  }

  try {
    const user = req.actor;

    // Every target quiz must belong to the caller (or the caller is an admin).
    const quizIds = [...new Set(questions.map((q) => (q && typeof q.quizId === "string" ? q.quizId.trim() : "")))];
    for (const quizId of quizIds) {
      if (!(await requireQuizOwner(res, user, quizId))) return;
    }

    const questionsToCreate = questions.map(question => {
      if (typeof question !== 'object' || question === null) {
        throw new Error("Each question must be an object");
      }
      if (typeof question.question_text !== 'string' || question.question_text.trim() === "") {
        throw new Error("Each question text is required");
      }
      if (!question.quizId || question.quizId.trim() === "") {
        throw new Error("Each question must have a valid quiz");
      }

      return {
        quizId: question.quizId.trim(),
        question_text: question.question_text.trim()
      };
    });

    const createdQuestions = await Question.bulkCreate(questionsToCreate);

    res.status(200).json({
      message: "Questions created successfully.",
      questions: createdQuestions,
    });
  } catch (e) {
    console.error('Error creating questions:', e);
    res.status(400).json({
      error_code: "create_questions",
      message: e.message,
    });
  }
};

const handleDeleteRequest = async (req, res) => {
  const { questionId } = req.query;
  try {
    const question = await requireQuestionOwner(res, req.actor, questionId);
    if (!question) return;

    await question.destroy({
      include: [
        { model: Answer_Option, onDelete: 'cascade' },
      ],
    });

    res.status(200).json({ message: "Question and related data deleted successfully" });
  } catch (e) {
    res.status(400).json({
      error_code: "delete_question",
      message: e.message,
    });
  }
};

const handleGetRequest = async (req, res) => {
  const { questionId } = req.query;
  try {
    if (!(await requireQuestionOwner(res, req.actor, questionId))) return;
    const question = await Question.findOne({
      include: [
        {
          model: Answer_Option,
          as: 'answer_options',
          attributes: ['id', 'questionId', 'option_text']
        }
      ],
      where: { id: questionId },
    });

    res.status(200).json({ question });
  } catch (e) {
    res.status(400).json({
      error_code: "get_question",
      message: e.message,
    });
  }
};

const handlePutRequest = async (req, res) => {
  const { questionId } = req.query;
  const {
    question_text,
    quizId
  } = req.body;
  try {
    const existing = await requireQuestionOwner(res, req.actor, questionId);
    if (!existing) return;
    // A question cannot be moved to another quiz through this route.
    if (quizId !== undefined && quizId !== existing.quizId) {
      return res.status(400).json({ message: "quizId cannot be changed" });
    }

    const [affectedRows] = await Question.update(
      { question_text },
      { where: { id: questionId, quizId: existing.quizId } }
    );

    if (affectedRows === 0) {
      return res.status(404).json({
        message: "Question not found",
      });
    }

    res.status(200).json({
      message: "Question updated successfully",
      updatedQuestion: affectedRows
    });
  } catch (e) {
    res.status(400).json({
      error_code: "update_question",
      message: e.message,
    });
  }
};