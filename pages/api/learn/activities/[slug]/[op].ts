import { route, str, badRequest } from "@/learn-together/server/http";
import { z } from "zod";
import { publishedBySlug } from "@/learn-together/server/content";
import { DismissedActivity, Feedback, KitInterest, SavedActivity } from "@/learn-together/server/models";
import { getChildForFamily } from "@/learn-together/server/family";
import { track } from "@/learn-together/server/analytics";
import { HttpError } from "@/learn-together/server/errors";

const childBody = z.object({ childProfileId: z.string().uuid().nullable().optional() });
const feedbackBody = z.object({ kind: z.enum(["usefulness_rating", "confusion", "safety_concern"]), rating: z.number().int().min(1).max(5).optional(), note: z.string().max(2000).optional() });

async function toggle(model: typeof SavedActivity, parent: { familyId: string }, activityId: string, body: unknown, on: boolean) {
  const { childProfileId } = childBody.parse(body || {});
  if (childProfileId) await getChildForFamily(parent.familyId, childProfileId);
  const where = { familyId: parent.familyId, activityId, childProfileId: childProfileId || null };
  if (on) {
    if (!(await model.count({ where }))) await model.create(where);
  } else await model.destroy({ where });
}

export default route({
  auth: "parent",
  handlers: {
    POST: async ({ parent, req }) => {
      const a = await publishedBySlug(str(req.query.slug));
      switch (str(req.query.op)) {
        case "save":
          await toggle(SavedActivity, parent, a.activityId, req.body, true);
          return { ok: true };
        case "dismiss":
          await toggle(DismissedActivity, parent, a.activityId, req.body, true);
          return { ok: true };
        case "kit-interest":
          if (!a.content.optionalKit) throw new HttpError(404, "No kit for this activity");
          await KitInterest.create({ userId: parent.userId, kitKey: a.content.optionalKit.kitKey, activityId: a.activityId, at: new Date() });
          await track("lt_kit_interest_clicked", { kitKey: a.content.optionalKit.kitKey, activityId: a.activityId }, { familyId: parent.familyId, req });
          return { ok: true };
        case "feedback": {
          const body = feedbackBody.parse(req.body || {});
          if (body.kind === "usefulness_rating" && !body.rating) throw badRequest("rating required");
          await Feedback.create({ userId: parent.userId, activityVersionId: a.versionId, kind: body.kind, rating: body.rating || null, note: body.note?.trim() || null });
          const ev = body.kind === "usefulness_rating" ? "lt_usefulness_rated" : body.kind === "confusion" ? "lt_confusion_reported" : "lt_safety_concern_reported";
          await track(ev, { activityId: a.activityId, activityVersionId: a.versionId, rating: body.rating || null }, { familyId: parent.familyId, req });
          return { ok: true };
        }
        default:
          throw new HttpError(404, "Not found");
      }
    },
    DELETE: async ({ parent, req }) => {
      const a = await publishedBySlug(str(req.query.slug));
      const op = str(req.query.op);
      if (op !== "save" && op !== "dismiss") throw new HttpError(404, "Not found");
      await toggle(op === "save" ? SavedActivity : DismissedActivity, parent, a.activityId, { childProfileId: req.query.childProfileId || null }, false);
      return { ok: true };
    },
  },
});
