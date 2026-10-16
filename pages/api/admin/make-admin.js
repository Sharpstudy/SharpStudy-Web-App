
import { requireRole } from "@/lib/auth/requireRole";
import { User } from "database/models";

export default async function handler(req, res) {
  const actor = await requireRole(req, res, ["admin"]);
  if (!actor) return;
  switch (req.method) {
    case "GET":
      await handleGet(req, res);
      break;
    case "PUT":
      await handlePut(req, res, actor);
      break;
    default:
      res.status(405).json({
        message: `Method ${req.method} not allowed`,
      });
  }
}

const handleGet = async (req, res) => {
  try {
    const admins = await User.findAll({
      order: [["created_at", "DESC"]],
      where: {
        role: "admin",
      },
    });

    res.status(200).json({ admins });
  } catch (e) {
    res.status(400).json({
      error_code: "get_courses_for_approve",
      message: e.message,
    });
  }
};

const handlePut = async (req, res, actor) => {
  try {
    const { userId, admin } = req.body;

    if (admin) {
      await User.update(
        {
          role: "admin",
        },
        { where: { id: userId } }
      );

      res.status(200).json({ message: "This user now has admin access" });
    } else {
      if (userId === actor.userId) {
        return res.status(422).json({ message: "You cannot remove your own admin access." });
      }
      // Only ever demotes an admin: it must not touch instructors or students.
      await User.update(
        {
          role: "student",
        },
        { where: { id: userId, role: "admin" } }
      );
      res.status(200).json({ message: "This user no longer has admin access" });
    }
  } catch (e) {
    res.status(400).json({
      error_code: "make_admin",
      message: e.message,
    });
  }
};
