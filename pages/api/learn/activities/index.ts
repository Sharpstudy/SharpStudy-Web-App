import { route } from "@/learn-together/server/http";
import { activitySummary, publishedCatalog } from "@/learn-together/server/content";
import { DismissedActivity, SavedActivity } from "@/learn-together/server/models";
import { canAccessTier } from "@/learn-together/domain/entitlements";

export default route({
  auth: "parent",
  handlers: {
    GET: async ({ parent }) => {
      const [catalog, saved, dismissed] = await Promise.all([
        publishedCatalog(),
        SavedActivity.findAll({ where: { familyId: parent.familyId } }),
        DismissedActivity.findAll({ where: { familyId: parent.familyId } }),
      ]);
      return {
        activities: catalog.map((a) => ({
          ...activitySummary(a),
          entitled: canAccessTier(parent, a.tier),
          saved: saved.some((s) => s.activityId === a.activityId),
          dismissed: dismissed.some((s) => s.activityId === a.activityId),
        })),
      };
    },
  },
});
