// Runtime dependencies for the credential flows (sign-in, forgot / reset password, Google). Server only.
import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import baseUrl from "@/utils/baseUrl";
import masteryRepo from "@/lib/mastery-server/repo";
import { sendMail } from "@/lib/meetings/mailer"; // the existing SES transport; reports "skipped" when credentials are not configured
import repo from "./credentialsRepo";
import { verifyGoogleIdToken } from "./googleVerify";

export const authDeps = () => ({
	repo,
	mailer: sendMail,
	now: () => new Date(),
	baseUrl: String(process.env.BASE_URL || baseUrl || "http://localhost:3000").replace(/\/$/, ""),
	randomToken: () => randomBytes(32).toString("hex"),
	hashPassword: (plain) => bcrypt.hash(plain, 10),
	compare: (plain, hash) => bcrypt.compare(plain, hash),
	randomPasswordHash: () => bcrypt.hash(randomBytes(32).toString("hex"), 10), // an unusable password (nobody knows it)
	verify: (idToken) => verifyGoogleIdToken(idToken),
	// Reuses the Mastery Ladder audit log; never contains tokens or passwords.
	audit: (action, userId) => masteryRepo.addAudit({ actor_user_id: userId, action, details: {} }),
});
