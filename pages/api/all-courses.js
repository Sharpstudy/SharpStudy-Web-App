import { Op } from "sequelize";
import { Course, User, Enrolment } from "database/models";
import connection from "@/database/connection";
import { likeOp } from "@/lib/db/dialect";
import { requireUser } from "@/lib/auth/access";

const LIKE = likeOp(connection);

// Course catalogue data: a signed-in account only (401 without a valid login, 403 for a role outside student / instructor / admin).
export default async function handler(req, res) {
  if (!(await requireUser(req, res))) return;
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

// const handleGetRequest = async (req, res) => {
//   const { page, limit, short, search } = req.query;
//   const pageNumber = parseInt(page);
//   const getRealNumber = isNaN(pageNumber) ? 0 : pageNumber;
//   const coursesOffset = limit * (getRealNumber - 1);
//   const LIMIT = parseInt(limit);
//   try {
//     let totalPages;
//     totalPages = await Course.count({ where: { approved: true } });

//     const courses = await Course.findAll({
//       where: {
//         [Op.or]: [
//           { title: { [LIKE]: `%${search}%` } },
//           { short_desc: { [LIKE]: `%${search}%` } },
//         ],
//         approved: true,
//       },
//       where: { approved: true },

//       order: short ? [["latest_price", short]] : [["created_at", "DESC"]],
//       include: [
//         {
//           model: User,
//           as: "user",
//           attributes: ["first_name", "last_name", "profile_photo"],
//         },
//         {
//           model: Enrolment,
//           as: "enrolments",
//           attributes: ["id"],
//         },
//       ],
//       offset: coursesOffset,
//       limit: LIMIT,
//     });

//     const coursesCount = await Course.count({
//       where: {
//         [Op.or]: [
//           { title: { [LIKE]: `%${search}%` } },
//           { short_desc: { [LIKE]: `%${search}%` } },
//         ],
//         approved: true,
//       },
//     });

//     totalPages = Math.ceil(totalPages / limit);

//     res.status(200).json({
//       courses,
//       totalPages,
//       coursesCount,
//     });
//   } catch (e) {
//     console.log("=========================", e);
//     res.status(400).json({
//       error_code: "get_all_courses",
//       message: e.message,
//     });
//   }
// };

const handleGetRequest = async (req, res) => {
  const { page, limit, short, search } = req.query;

  // Parse page and limit parameters to integers, and provide default values if they are not valid
  const pageNumber = parseInt(page) || 1;
  const parsedLimit = parseInt(limit) || 10;

  // Provide a default empty string if search parameter is undefined
  const searchTerm = search || '';

  try {
    // Count total number of courses
    const totalCourses = await Course.count({ where: { approved: true } });

    // Calculate the offset for pagination
    const coursesOffset = parsedLimit * (pageNumber - 1);

    // Find courses with pagination, filtering, sorting, and including associations
    const courses = await Course.findAll({
      where: {
        approved: true,
        [Op.or]: [
          { title: { [LIKE]: `%${searchTerm}%` } },
          { short_desc: { [LIKE]: `%${searchTerm}%` } },
        ],
      },
      order: short ? [["latest_price", short]] : [["created_at", "DESC"]],
      include: [
        {
          model: User,
          as: "user",
          attributes: ["first_name", "last_name", "profile_photo"],
        },
        {
          model: Enrolment,
          as: "enrolments",
          attributes: ["id"],
        },
      ],
      offset: coursesOffset,
      limit: parsedLimit,
    });

    // Calculate total pages
    const totalPages = Math.ceil(totalCourses / parsedLimit);

    // Send the response with paginated courses, total pages, and total courses count
    res.status(200).json({
      courses,
      totalPages,
      coursesCount: totalCourses,
    });
  } catch (e) {
    // Handle errors and send a 400 response with the error message
    res.status(400).json({
      error_code: "get_all_courses",
      message: e.message,
    });
  }
};




