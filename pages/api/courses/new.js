import { slugify } from "@/utils/auth";
import Course from "database/models/course";
import { requireRole } from "@/lib/auth/requireRole";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: `Method ${req.method} not allowed` });
  }
  // 401 for a missing/invalid token, 403 for roles that may not create courses.
  // The role is re-read from the database, never taken from the browser.
  const actor = await requireRole(req, res, ["instructor", "admin"]);
  if (!actor) return;
  switch (req.method) {
    case "POST":
      await handlePostRequest(req, res, actor);
      break;
    default:
      res.status(405).json({
        message: `Method ${req.method} not allowed`,
      });
  }
}

const handlePostRequest = async (req, res, actor) => {
  const {
    title,
    short_desc,
    overview,
    latest_price,
    before_price,
    lessons,
    duration,
    image,
    access_time,
    requirements,
    what_you_will_learn,
    who_is_this_course_for,
    catId,
    is_class,
  } = req.body;
  try {
    // The owner is always the authenticated user; any userId in the body is ignored.
    const userId = actor.userId;

    let slug = slugify(title);
    const slugExist = await Course.findOne({
      where: { slug: slug },
    });

    if (slugExist) {
      slug = `${slug}-${Math.floor(
        Math.random() * (999 - 100 + 1) + 100
      )}`;
    }

    const newcourse = await Course.create({
      title,
      slug,
      short_desc,
      overview,
      latest_price,
      before_price,
      lessons,
      duration,
      image,
      access_time,
      requirements,
      what_you_will_learn,
      who_is_this_course_for,
      userId,
      catId,
      is_class: is_class && true,
    });

    res.status(200).json({
      message:
        "Course created successfully. Please wait until approved by an admin.",
      course: newcourse,
    });
  } catch (e) {
    res.status(400).json({
      error_code: "create_course",
      message: e.message,
    });
  }
};
