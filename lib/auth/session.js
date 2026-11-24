// The one place a login token is minted. Same payload and lifetime as before (the rest of the application reads these claims), now shared
// by e-mail sign-in, Google sign-in and profile updates. `iat` (added by jsonwebtoken) is what lib/auth/tokenRevocation.js compares with
// users.password_changed_at.
import jwt from "jsonwebtoken";

export const SESSION_TTL = "7d";

export const signSession = (user) =>
	jwt.sign(
		{ userId: user.id, first_name: user.first_name, last_name: user.last_name, email: user.email, role: user.role, profile_photo: user.profile_photo },
		process.env.JWT_SECRET,
		{ expiresIn: SESSION_TTL }
	);
