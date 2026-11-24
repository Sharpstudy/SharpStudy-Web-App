// Family PIN, pairing codes and child devices (tables created by
// migrations/20261023000000-family-child-devices.js). Used only through lib/family/repo.js.
import { Model, DataTypes } from "sequelize";
import connection from "../connection";

const opts = (modelName, tableName) => ({
	sequelize: connection,
	modelName,
	tableName,
	createdAt: "created_at",
	updatedAt: "updated_at",
});
const id = { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true };
const uuid = (allowNull = false) => ({ type: DataTypes.UUID, allowNull });

export class FamPin extends Model {}
FamPin.init(
	{
		id,
		user_id: uuid(),
		pin_hash: { type: DataTypes.STRING(100), allowNull: false },
		failed_attempts: { type: DataTypes.INTEGER, defaultValue: 0 },
		locked_until: DataTypes.DATE,
	},
	opts("FamPin", "fam_pins")
);

export class FamPairingCode extends Model {}
FamPairingCode.init(
	{
		id,
		owner_user_id: uuid(),
		created_by: uuid(),
		code_hash: { type: DataTypes.STRING(64), allowNull: false },
		learner_ids: {
			type: DataTypes.JSON,
			allowNull: false,
			get() {
				const v = this.getDataValue("learner_ids");
				if (typeof v === "string") {
					try {
						return JSON.parse(v);
					} catch (e) {
						return [];
					}
				}
				return v;
			},
		},
		status: { type: DataTypes.ENUM("open", "claimed", "approved", "denied", "cancelled"), defaultValue: "open" },
		expires_at: { type: DataTypes.DATE, allowNull: false },
		claimed_at: DataTypes.DATE,
	},
	opts("FamPairingCode", "fam_pairing_codes")
);

export class FamDevice extends Model {}
FamDevice.init(
	{
		id,
		owner_user_id: uuid(),
		pairing_code_id: uuid(),
		name: DataTypes.STRING(60),
		label: { type: DataTypes.STRING(80), allowNull: false, defaultValue: "Device" },
		secret_hash: { type: DataTypes.STRING(64), allowNull: false },
		status: { type: DataTypes.ENUM("pending", "approved", "denied", "revoked"), defaultValue: "pending" },
		pending_until: { type: DataTypes.DATE, allowNull: false },
		approved_at: DataTypes.DATE,
		approved_by: uuid(true),
		revoked_at: DataTypes.DATE,
		revoked_by: uuid(true),
		last_seen_at: DataTypes.DATE,
	},
	opts("FamDevice", "fam_devices")
);

export class FamDeviceLearner extends Model {}
FamDeviceLearner.init({ id, device_id: uuid(), learner_id: uuid() }, opts("FamDeviceLearner", "fam_device_learners"));

export class FamLinkCode extends Model {}
FamLinkCode.init(
	{
		id,
		learner_id: uuid(),
		issued_by: uuid(),
		code_hash: DataTypes.STRING(64),
		status: { type: DataTypes.ENUM("open", "used", "cancelled"), defaultValue: "open" },
		expires_at: { type: DataTypes.DATE, allowNull: false },
		used_by: uuid(true),
		used_at: DataTypes.DATE,
	},
	opts("FamLinkCode", "fam_link_codes")
);
