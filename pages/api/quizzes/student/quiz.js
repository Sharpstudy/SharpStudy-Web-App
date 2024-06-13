import { verifyUser } from "@/utils/auth";
import { Quiz, Question, Answer_Option, Enrolment, Course } from "database/models";

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

