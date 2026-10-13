import { route, str } from "@/learn-together/server/http";
import { z } from "zod";
import { adminDetail, publishVersion, recordReview, requestReviews, retire, rollback, saveDraft, setTier, REVIEW_TYPES } from "@/learn-together/server/content";
import { requireLtRole } from "@/learn-together/server/auth";

const op = z.discriminatedUnion("op", [
  z.object({ op: z.literal("request_reviews"), versionId: z.string().uuid() }),
  z.object({ op: z.literal("review"), versionId: z.string().uuid(), reviewType: z.enum(REVIEW_TYPES), decision: z.enum(["approved", "changes_requested"]), notes: z.string().max(2000).optional() }),
  z.object({ op: z.literal("publish"), versionId: z.string().uuid() }),
  z.object({ op: z.literal("rollback"), versionId: z.string().uuid() }),
  z.object({ op: z.literal("retire") }),
  z.object({ op: z.literal("tier"), tier: z.enum(["free", "paid"]) }),
]);

export default route({
  auth: "user",
  roles: ["lt_editor", "lt_reviewer"],
  handlers: {
    GET: async ({ req }) => adminDetail(str(req.query.id)),
    PUT: async ({ parent, req }) => {
      requireLtRole(parent, ["lt_editor"]);
      return saveDraft(parent.userId, (req.body || {}).content);
    },
    POST: async ({ parent, req }) => {
      const body = op.parse(req.body || {});
      const id = str(req.query.id);
      switch (body.op) {
        case "request_reviews":
          requireLtRole(parent, ["lt_editor"]);
          await requestReviews(parent.userId, body.versionId);
          break;
        case "review":
          requireLtRole(parent, ["lt_reviewer"]);
          return recordReview(parent.userId, body.versionId, body.reviewType, body.decision, body.notes);
        case "publish":
          requireLtRole(parent, ["lt_editor"]);
          await publishVersion(parent.userId, body.versionId);
          break;
        case "rollback":
          requireLtRole(parent, ["lt_admin"]);
          await rollback(parent.userId, id, body.versionId);
          break;
        case "retire":
          requireLtRole(parent, ["lt_admin"]);
          await retire(parent.userId, id);
          break;
        case "tier":
          requireLtRole(parent, ["lt_admin"]);
          await setTier(parent.userId, id, body.tier);
          break;
      }
      return { ok: true };
    },
  },
});
