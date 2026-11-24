import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import isEmail from "validator/lib/isEmail";
import isLength from "validator/lib/isLength";

import User from "database/models/user";
import connection from "@/database/connection";
import { ciEquals, normalizeEmail } from "@/lib/db/dialect";
import { rateLimit } from "@/lib/mastery-server/http";
import { passwordProblem } from "@/lib/auth/passwordPolicy";

import { confirmEmailAddress } from "email-templates/account-confirmation";

export default async function handler(req, res) {
  switch (req.method) {
    case "POST":
      await userSignup(req, res);
      break;
    default:
      res.status(405).json({
        message: `Method ${req.method} not allowed`,
      });
  }
}

const userSignup = async (req, res) => {
  // Each signup sends an e-mail and creates a row: limit per client address.
  if (!rateLimit(req, res, "signup", { windowMs: 60 * 60 * 1000, max: 20 })) return;
  const confirmToken = uuidv4();
  let { first_name, last_name, email, password, next } = req.body || {};
  // Missing / non-string fields are validation failures (422 below), not a thrown validator error (400).
  [first_name, last_name, email, password] = [first_name, last_name, email, password].map((v) =>
    typeof v === "string" ? v : ""
  );
  email = normalizeEmail(email);
  try {
    if (!isLength(first_name, { min: 3 })) {
      return res.status(422).json({
        message:
          "The first name should be a minimum of three characters long",
      });
    } else if (!isLength(last_name, { min: 3 })) {
      return res.status(422).json({
        message:
          "The last name should be a minimum of three characters long",
      });
    } else if (!isEmail(email)) {
      return res
        .status(422)
        .json({ message: "Email should be a valid email address" });
    }
    const weak = passwordProblem(password, { email });
    if (weak) {
      return res.status(422).json({ message: weak });
    }

    // Check if user with that email if already exists
    const user = await User.findOne({
      where: ciEquals(connection, "email", email),
    });

    if (user) {
      return res
        .status(422)
        .json({ message: `User already exist with email ${email}` });
    }

    // Encrypt password with bcrypt
    const passwordHash = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      first_name,
      last_name,
      email,
      password: passwordHash,
      reset_password_token: confirmToken,
      reset_password_send_at: Date.now(),
    });

    // Sending is awaited (a serverless function can be frozen right after the response). A mail problem never fails the sign-up:
    // the person can ask for the e-mail again.
    await confirmEmailAddress(newUser, next);

    // No login token is issued here: the account cannot be used until the e-mail address is confirmed (sign-in refuses it, and so do
    // the protected APIs). The page shows the check-your-email screen instead.
    res.status(200).json({
      message: "Account created. Please check your email to confirm your address.",
      verification_required: true,
      email: newUser.email,
    });
  } catch (e) {
    res.status(400).json({
      error_code: "create_user",
      message: e.message,
    });
  }
};
