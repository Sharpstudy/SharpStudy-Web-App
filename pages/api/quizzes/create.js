import jwt from 'jsonwebtoken';
import { slugify } from "@/utils/auth";
import { Quiz } from "database/models";

export default async function handler(req, res) {
  if (!("authorization" in req.headers)) {
    return res.status(401).json({ message: "No autorization token" });
  }
  switch (req.method) {
    case "POST":
      await handlePostRequest(req, res);
      break;
    case "DELETE":
      await handleDeleteRequest(req, res);
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
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      // Token comes from the UI or Swagger docs
      token = req.headers.authorization.split(' ')[1];

    } else if (req.headers.authorization) {
      // Token comes without the "Bearer " prefix
      token = req.headers.authorization;
    } else {
      return res.status(401).json({ message: "Invalid or missing authorization header" });
    }

    // Verify the token using the extracted token variable
    const user = jwt.verify(token, process.env.JWT_SECRET);

    if (user.role === 'student') {
      return res.status(401).json({ message: "User is not authorized to create a quiz" });
    }

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