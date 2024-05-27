import { verifyUser } from "@/utils/auth"
import { Question, Answer_Option } from "database/models";

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
  const answers = req.body
  if (!Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ message: "Answer-Options should be a non-empty array" });
  }

  try {
    const user = await verifyUser(req, res);

    if (user.role === 'student') {
      return res.status(401).json({ message: "User is not authorized to create these answer-options" });
    }

    // Ensure all questionId values in the array are the same
    const firstQuestionId = answers[0]['questionId'];
    const allSameQuestionId = answers.every(option => option.questionId === firstQuestionId);

    if (!allSameQuestionId) {
      return res.status(400).json({ message: "Questions for this answer options must be the same" });
    }

    const checkAnswerOptions = await Answer_Option.findAll({
      where: { questionId: firstQuestionId }
    })

    if (checkAnswerOptions.length !== 0) {
      return res.status(400).json({ message: "Answers Options already exist for this question" })
    }

    const checkQuestion = await Question.findOne({
      where: { id: firstQuestionId }
    });

    if (!checkQuestion) {
      return res.status(404).json({ message: "Question not found" });
    }

    const answerOptionsToCreate = answers.map(option => {
      if (typeof option !== 'object' || option === null) {
        throw new Error("Each answer option must be an object");
      }
      if (typeof option.option_text !== 'string' || option.option_text.trim() === "") {
        throw new Error("Each answer option text is required");
      }
      if (!option.questionId || option.questionId.trim() === "") {
        throw new Error("Each answer option must have a valid question");
      }
      if (typeof option.is_correct !== 'boolean') {
        throw new Error("is_correct field must be a boolean");
      }

      return {
        questionId: option.questionId.trim(),
        option_text: option.option_text.trim(),
        is_correct: option.is_correct
      };
    });

    const createdAnswerOptions = await Answer_Option.bulkCreate(answerOptionsToCreate);

    res.status(200).json({
      message: `Answer Options for question ID ${createdAnswerOptions[0].questionId}  created successfully.`,
      answer_options: createdAnswerOptions,
    });
  } catch (e) {
    console.error('Error creating answer_options:', e);
    res.status(400).json({
      error_code: "create_answer_options",
      message: e.message,
    });
  }
};
