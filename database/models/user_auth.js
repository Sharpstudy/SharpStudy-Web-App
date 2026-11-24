// A narrow view of the `users` table holding ONLY what the credential flows need (password reset, sign-in lockout, session
// revocation, Google link). It is a separate model on purpose: the main User model (database/models/user.js) keeps selecting
// exactly the columns it always did, so nothing else in the application can break if the migration
// 20261110000000-add-auth-security-columns has not been applied yet. Only code in lib/auth/credentialsRepo.js uses this model.
import { Model, DataTypes } from "sequelize";
import connection from "../connection";

class UserAuth extends Model {}
UserAuth.init(
	{
		id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
		email: DataTypes.STRING,
		first_name: DataTypes.STRING,
		last_name: DataTypes.STRING,
		role: DataTypes.STRING,
		status: DataTypes.BOOLEAN,
		email_confirmed: DataTypes.BOOLEAN,
		email_confirmed_at: DataTypes.DATE,
		password: DataTypes.STRING,
		profile_photo: DataTypes.STRING,
		password_reset_token_hash: DataTypes.CHAR(64),
		password_reset_expires_at: DataTypes.DATE,
		password_reset_requested_at: DataTypes.DATE,
		password_changed_at: DataTypes.DATE,
		failed_login_count: { type: DataTypes.INTEGER, defaultValue: 0 },
		locked_until: DataTypes.DATE,
		google_sub: DataTypes.STRING(64),
	},
	{ sequelize: connection, modelName: "UserAuth", tableName: "users", createdAt: "created_at", updatedAt: "updated_at" }
);

export default UserAuth;
