import { verifyUser } from "@/utils/auth"
import { Quiz, Question, Answer_Option } from "database/models";

export default async function handler(req, res) {
  if (!("authorization" in req.headers)) {
    return res.status(401).json({ message: "No autorization token" });
  }
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
    const user = await verifyUser(req, res);

    if (user.role === 'student') {
      return res.status(401).json({ message: "User is not authorized to create these questions" });
    }

    const checkQuiz = await Quiz.findOne({
      where: { id: questions[0]['quizId'], userId: user.userId }
    });

    if (!checkQuiz) {
      return res.status(404).json({ message: "Quiz not found" });
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
    const user = await verifyUser(req, res);
    const question = await Question.findOne({
      where: { id: questionId },
    });

    if (!question) {
      return res.status(404).json({ message: "Question not found" });
    }

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
    await verifyUser(req, res);
    const question = await Question.findOne({
      include: [
        {
          model: Answer_Option,
          as: 'answer_options',
          attributes: ['questionId', 'option_text']
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