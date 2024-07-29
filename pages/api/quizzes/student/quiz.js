import { verifyUser } from "@/utils/auth";
import { Quiz, Question, Answer_Option, Enrolment, Course, User_Response } from "database/models";

export default async function handler(req, res) {
  if (!("authorization" in req.headers)) {
    return res.status(401).json({ message: "No authorization token" });
  }
  switch (req.method) {
    case "GET":
      if (req.query.quizId) {
        await handleGetRequest(req, res);
      } else if (req.query.courseId) {
        await handleGetCourseQuizzesRequest(req, res);
      } else {
        res.status(400).json({ message: "Invalid query parameters" });
      }
      break;
    case "POST":
      await handlePostRequest(req, res)
      break
    default:
      res.status(405).json({
        message: `Method ${req.method} not allowed`,
      });
  }
}


const handleGetRequest = async (req, res) => {
  const { quizId } = req.query;
  try {
    const user = await verifyUser(req, res);

    if (user.role !== 'student') {
      return res.status(401).json({ message: "User is not Student" });
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
      where: { id: quizId },
    });

    const userEnrollments = await Enrolment.findAll({ where: { userId: user.userId } })

    const enrolledCourseIds = userEnrollments.map(enrollment => enrollment.courseId)

    // Check if student is enrolled in the quiz course
    if (!enrolledCourseIds.includes(quiz.courseId)) {
      return res.status(403).json({ message: "User is not enrolled in this quiz course" });
    }

    res.status(200).json({ quiz });
  } catch (e) {
    res.status(400).json({
      error_code: "get_quiz",
      message: e.message,
    });
  }
};

const handleGetCourseQuizzesRequest = async (req, res) => {
  const { courseId } = req.query;
  try {
    const user = await verifyUser(req, res);

    if (user.role !== 'student') {
      return res.status(401).json({ message: "User is not Student" });
    }

    const userEnrollments = await Enrolment.findAll({ where: { userId: user.userId } })

    const enrolledCourseIds = userEnrollments.map(enrollment => enrollment.courseId)

    const courseQuizzes = await Course.findOne({
      attributes: ['id', 'title', 'short_desc', 'catId', 'image'],
      include: [
        {
          model: Quiz,
          as: 'quizzes',
          attributes: ['id', 'title', 'description', 'slug', 'courseId'],
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
          ]
        }
      ],
      where: { id: courseId },
    });

    if (!courseQuizzes) {
      return res.status(404).json({ message: "Course not available" })
    }

    if (!enrolledCourseIds.includes(courseQuizzes.id)) {
      return res.status(401).json({ message: "You are not enrolled in this course" })
    }

    res.status(200).json({ courseQuizzes });
  } catch (e) {
    res.status(400).json({
      error_code: "get_course_quizzes",
      message: e.message,
    });
  }
};

const handlePostRequest = async (req, res) => {
  const { questionId, selectedAnswerIds } = req.body

  try {
    const user = await verifyUser(req, res)

    // Query the question and answer options and include the quiz the question belong to
    const question = await Question.findOne({
      include: [
        {
          model: Answer_Option,
          as: 'answer_options',
          attributes: ['id', 'is_correct']
        },
        {
          model: Quiz,
          as: 'quiz',
          attributes: ['id', 'courseId']
        }
      ],
      where: { id: questionId }
    })

    // Verify student enrollment
    const studentEnrolments = await Enrolment.findOne({
      where: {
        userId: user.userId,
        courseId: question.quiz.courseId
      }
    })

    if (!studentEnrolments) {
      return res.status(401).json({ message: "Student is not enrolled in this course" });
    }

    // Check if there is an existing response for this question
    const existingResponse = await User_Response.findOne({
      where: {
        enrolmentId: studentEnrolments.id,
        questionId: question.id
      }
    });

    if (existingResponse && existingResponse.is_answered_correctly) {
      return res.status(422).json({ message: "Question has already been answered correctly" });
    }

    // Retrieve the correct answers
    const correctAnswers = question.answer_options.filter(option => option.is_correct);
    const correctAnswerIds = correctAnswers.map(option => option.id);

    // Check if the selected answers match the correct answers exactly 
    const isAnsweredCorrectly = selectedAnswerIds.length === correctAnswerIds.length && selectedAnswerIds.every(answerId => correctAnswerIds.includes(answerId))

    const answerStatus = isAnsweredCorrectly ? 'correct' : 'incorrect';

    if (existingResponse) {
      // Update the existing response if necessary
      existingResponse.is_answered_correctly = isAnsweredCorrectly;
      existingResponse.updated_at = new Date()
      await existingResponse.save();
      res.status(200).json({ message: "User response updated successfully", status: answerStatus });
    } else {
      // Save the new user response
      await User_Response.create({
        enrolmentId: studentEnrolments.id,
        questionId: question.id,
        is_answered_correctly: isAnsweredCorrectly
      });
      res.status(201).json({ message: "User response saved successfully", status: answerStatus });
    }

  } catch (e) {
    res.status(400).json({
      error_code: "user_answered_question",
      message: e.message,
    });

  }
}

