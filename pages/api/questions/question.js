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
  const { question_text, quizId } = req.body;
  try {
    const user = await verifyUser(req, res);

    if (user.role === 'student') {
      return res.status(401).json({ message: "User is not authorized to create this question" });
    }

    const checkQuiz = await Quiz.findOne({
      where: { id: quizId, userId: user.userId }
    });

    if (!checkQuiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }

    const newQuestion = await Question.create({
      quizId: checkQuiz.id,
      question_text: question_text
    });

    res.status(200).json({
      message: "Question created successfully.",
      question: newQuestion,
    });
  } catch (e) {
    console.error('Error creating question:', e);
    res.status(400).json({
      error_code: "create_question",
      message: e.message,
    });
  }
};


// const handlePostRequest = async (req, res) => {
//   const {
//     question_text,
//     quizId
//   } = req.body;
//   try {
//     const user = await verifyUser(req, res);

//     if (user.role === 'student') {
//       return res.status(401).json({ message: "User is not authorized to create this question" });
//     }

//     const checkQuiz = await Quiz.findOne({
//       where: { id: quizId, userId: user['userId'] }
//     })

//     // Check if quiz exists
//     if (!checkQuiz) {
//       return res.status(404).json({ message: "Quiz not found" });
//     }

//     // // console.log('checkQuiz', checkQuiz);
//     // const newObj = {
//     //   'quizId': 'e873a54b-be4f-427f-a24f-f0051cb399bd',
//     //   // 'quizId': checkQuiz['id'],
//     //   'question_text': 'question_text'
//     //   // 'question_text': question_text
//     // };

//     // console.log('newObj', newObj);

//     const newQuestion = await Question.create({
//       quizId: checkQuiz.id,
//       question_text: question_text
//     });

//     res.status(200).json({
//       message:
//         "Question created successfully.",
//       question: newQuestion,
//     });
//   } catch (e) {
//     console.error('e', e); // Log the error for debugging

//     res.status(400).json({
//       error_code: "create_question",
//       message: e.message,
//     });
//   }
// };