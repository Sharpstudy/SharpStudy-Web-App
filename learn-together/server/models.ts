// Sequelize models for Learn Together (tables created by 20261013000001-create-learn-together.js).
// Attributes are camelCase; `underscored` maps them to the snake_case columns.
import { DataTypes, Model, ModelStatic, Sequelize } from "sequelize";
import connection from "@/database/connection";

const sequelize = connection as unknown as Sequelize;
const T = DataTypes;
const uuidPk = { type: T.UUID, defaultValue: T.UUIDV4, primaryKey: true };

// Rows are handled as plain records; typing every model generically adds little here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Model<any, any> & Record<string, any>;
export type M = ModelStatic<Row>;

const define = (name: string, table: string, attrs: Record<string, unknown>, opts: Record<string, unknown> = {}): M =>
  (sequelize.models[name] as M) ||
  (sequelize.define(name, { id: uuidPk, ...attrs } as never, {
    tableName: table,
    underscored: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    ...opts,
  }) as unknown as M);

export const Family = define("LtFamily", "lt_families", {
  name: T.STRING(80),
  createdByUserId: T.UUID,
  familyPinHash: T.STRING,
  pinFailedAttempts: { type: T.INTEGER, defaultValue: 0 },
  pinLockedUntil: T.DATE,
});

export const FamilyMember = define("LtFamilyMember", "lt_family_members", {
  familyId: T.UUID,
  userId: T.UUID,
  role: T.ENUM("owner", "caregiver"),
  invitedAt: T.DATE,
  joinedAt: T.DATE,
});

export const CaregiverInvite = define("LtCaregiverInvite", "lt_caregiver_invites", {
  familyId: T.UUID,
  email: T.STRING,
  tokenHash: T.STRING(64),
  invitedByUserId: T.UUID,
  expiresAt: T.DATE,
  acceptedAt: T.DATE,
  acceptedByUserId: T.UUID,
  revokedAt: T.DATE,
});

export const RoleAssignment = define("LtRoleAssignment", "lt_role_assignments", {
  userId: T.UUID,
  role: T.ENUM("lt_editor", "lt_reviewer", "lt_admin"),
  grantedByUserId: T.UUID,
});

export const ChildProfile = define("LtChildProfile", "lt_child_profiles", {
  familyId: T.UUID,
  nickname: T.STRING(40),
  avatarKey: T.STRING(40),
  ageBand: T.ENUM("6-7", "7-8", "8-9"),
  language: { type: T.STRING(10), defaultValue: "en" },
  readAloud: { type: T.BOOLEAN, defaultValue: false },
  largeText: { type: T.BOOLEAN, defaultValue: false },
  reducedMotion: { type: T.BOOLEAN, defaultValue: false },
  subjectInterests: T.JSON,
  pictureCodeHash: T.STRING,
  pictureCodeFailed: { type: T.INTEGER, defaultValue: 0 },
  pictureCodeLockedUntil: T.DATE,
});

export const ChildDevice = define("LtChildDevice", "lt_child_devices", {
  familyId: T.UUID,
  label: T.STRING(60),
  deviceTokenHash: T.STRING(64),
  pairedByUserId: T.UUID,
  pairedAt: T.DATE,
  lastSeenAt: T.DATE,
  revokedAt: T.DATE,
});

export const ChildDeviceProfile = define("LtChildDeviceProfile", "lt_child_device_profiles", {
  childDeviceId: T.UUID,
  childProfileId: T.UUID,
});

export const PairingRequest = define("LtPairingRequest", "lt_pairing_requests", {
  familyId: T.UUID,
  codeHash: T.STRING(64),
  childProfileIds: T.JSON,
  createdByUserId: T.UUID,
  expiresAt: T.DATE,
  failedAttempts: { type: T.INTEGER, defaultValue: 0 },
  lockedAt: T.DATE,
  claimTokenHash: T.STRING(64),
  claimedAt: T.DATE,
  claimedDeviceLabel: T.STRING(60),
  approvedAt: T.DATE,
  approvedByUserId: T.UUID,
  deniedAt: T.DATE,
  childDeviceId: T.UUID,
  deliveredAt: T.DATE,
});

export const Activity = define("LtActivity", "lt_activities", {
  slug: T.STRING(80),
  subject: T.ENUM("math", "science"),
  activityType: T.STRING(40),
  tier: { type: T.ENUM("free", "paid"), defaultValue: "free" },
  currentPublishedVersionId: T.UUID,
  status: { type: T.ENUM("draft", "published", "retired"), defaultValue: "draft" },
});

export const ActivityVersion = define("LtActivityVersion", "lt_activity_versions", {
  activityId: T.UUID,
  version: T.INTEGER,
  locale: { type: T.STRING(10), defaultValue: "en" },
  content: T.JSON,
  reviewState: { type: T.ENUM("draft", "in_review", "approved", "published", "superseded", "rejected"), defaultValue: "draft" },
  createdBy: T.UUID,
  publishedAt: T.DATE,
});

export const ContentReview = define("LtContentReview", "lt_content_reviews", {
  activityVersionId: T.UUID,
  reviewType: T.ENUM("subject", "developmental", "accessibility", "safety", "editorial"),
  reviewerUserId: T.UUID,
  decision: { type: T.ENUM("requested", "approved", "changes_requested"), defaultValue: "requested" },
  notes: T.TEXT,
  at: T.DATE(3),
});

export const SessionGroup = define("LtSessionGroup", "lt_session_groups", {
  familyId: T.UUID,
  hostUserId: T.UUID,
  activityVersionId: T.UUID,
  mode: T.ENUM("connected", "single_device"),
  state: { type: T.ENUM("lobby", "active", "paused", "ended"), defaultValue: "lobby" },
  currentStepIndex: { type: T.INTEGER, defaultValue: 0 },
  maxStepIndex: { type: T.INTEGER, defaultValue: 0 },
  stepCount: T.INTEGER,
  seq: { type: T.INTEGER, defaultValue: 0 },
  durationMode: { type: T.ENUM("full", "short"), defaultValue: "full" },
  stepChangedAt: T.DATE(3),
  startedAt: T.DATE,
  endedAt: T.DATE,
});

export const Session = define("LtSession", "lt_sessions", {
  groupId: T.UUID,
  childProfileId: T.UUID,
  status: { type: T.ENUM("in_progress", "completed", "abandoned"), defaultValue: "in_progress" },
  startedAt: T.DATE,
  completedAt: T.DATE,
  activeSeconds: { type: T.INTEGER, defaultValue: 0 },
});

export const SessionParticipant = define("LtSessionParticipant", "lt_session_participants", {
  groupId: T.UUID,
  childProfileId: T.UUID,
  childDeviceId: T.UUID,
  joinedAt: T.DATE,
  lastAckSeq: { type: T.INTEGER, defaultValue: 0 },
  presence: { type: T.ENUM("online", "offline"), defaultValue: "offline" },
  lastPresenceAt: T.DATE,
  readyAt: T.DATE,
});

export const StepEvent = define("LtStepEvent", "lt_step_events", {
  sessionId: T.UUID,
  stepId: T.STRING(80),
  stepIndex: T.INTEGER,
  enteredAt: T.DATE(3),
  exitedAt: T.DATE(3),
});

export const ChildResponse = define("LtChildResponse", "lt_child_responses", {
  sessionId: T.UUID,
  childProfileId: T.UUID,
  childDeviceId: T.UUID,
  itemKey: T.STRING(80),
  value: T.JSON,
  isCorrect: T.BOOLEAN,
  submittedAt: T.DATE(3),
});

export const HelpSignal = define("LtHelpSignal", "lt_help_signals", {
  sessionId: T.UUID,
  childProfileId: T.UUID,
  stepId: T.STRING(80),
  raisedAt: T.DATE(3),
  acknowledgedAt: T.DATE(3),
});

export const SessionCheck = define("LtSessionCheck", "lt_session_checks", {
  sessionId: T.UUID,
  questionKey: T.ENUM("near", "transfer"),
  parentInterpretation: T.ENUM("clear", "partial", "not_yet"),
  recordedByUserId: T.UUID,
});

export const MisconceptionSeen = define("LtMisconceptionSeen", "lt_misconceptions_seen", {
  sessionId: T.UUID,
  childProfileId: T.UUID,
  misconceptionKey: T.STRING(80),
  stepId: T.STRING(80),
  at: T.DATE(3),
});

export const Observation = define("LtObservation", "lt_observations", {
  sessionId: T.UUID,
  childProfileId: T.UUID,
  conceptTags: T.JSON,
  outcome: T.ENUM("understood", "practice_again", "not_sure"),
  parentNote: T.TEXT,
  recordedByUserId: T.UUID,
  editedAt: T.DATE,
  deletedAt: T.DATE,
});

export const ConceptProgress = define("LtConceptProgress", "lt_concept_progress", {
  childProfileId: T.UUID,
  conceptTag: T.STRING(80),
  status: T.ENUM("introduced", "practicing", "confident"),
  statusSource: { type: T.ENUM("computed", "parent_override"), defaultValue: "computed" },
  overrideAt: T.DATE,
  sessionsCount: { type: T.INTEGER, defaultValue: 0 },
  lastPracticedAt: T.DATE,
});

export const ParentConfidence = define("LtParentConfidence", "lt_parent_confidence", {
  sessionId: T.UUID,
  userId: T.UUID,
  rating: T.TINYINT,
});

export const SavedActivity = define("LtSavedActivity", "lt_saved_activities", {
  familyId: T.UUID,
  childProfileId: T.UUID,
  activityId: T.UUID,
});

export const DismissedActivity = define("LtDismissedActivity", "lt_dismissed_activities", {
  familyId: T.UUID,
  childProfileId: T.UUID,
  activityId: T.UUID,
});

export const KitInterest = define("LtKitInterest", "lt_kit_interest", {
  userId: T.UUID,
  kitKey: T.STRING(80),
  activityId: T.UUID,
  at: T.DATE,
});

export const Feedback = define("LtFeedback", "lt_feedback", {
  userId: T.UUID,
  activityVersionId: T.UUID,
  kind: T.ENUM("usefulness_rating", "confusion", "safety_concern"),
  rating: T.TINYINT,
  note: T.TEXT,
});

const bigPk = { id: { type: T.BIGINT, autoIncrement: true, primaryKey: true } };

export const AuditLog = define(
  "LtAuditLog",
  "lt_audit_log",
  {
    ...bigPk,
    actorType: T.ENUM("user", "child_device", "system"),
    actorId: T.STRING(64),
    action: T.STRING(80),
    entityType: T.STRING(60),
    entityId: T.STRING(64),
    before: T.JSON,
    after: T.JSON,
    at: { type: T.DATE(3), defaultValue: T.NOW },
  },
  { timestamps: false }
);

export const AnalyticsEvent = define(
  "LtAnalyticsEvent",
  "lt_analytics_events",
  {
    ...bigPk,
    name: T.STRING(60),
    familyKey: T.STRING(64),
    deviceClass: T.STRING(20),
    props: T.JSON,
    at: { type: T.DATE(3), defaultValue: T.NOW },
  },
  { timestamps: false }
);

export const RateLimit = define(
  "LtRateLimit",
  "lt_rate_limits",
  { id: { type: T.STRING(191), primaryKey: true, field: "key" }, windowStart: T.DATE, count: T.INTEGER },
  { timestamps: false }
);

export { sequelize };
