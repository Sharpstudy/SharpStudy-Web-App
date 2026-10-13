import { route, str } from "@/learn-together/server/http";
import { activitySummary, publishedBySlug } from "@/learn-together/server/content";
import { canAccessTier } from "@/learn-together/domain/entitlements";
import { track } from "@/learn-together/server/analytics";

export default route({
  auth: "parent",
  handlers: {
    GET: async ({ parent, req }) => {
      const a = await publishedBySlug(str(req.query.slug));
      const entitled = canAccessTier(parent, a.tier);
      await track("lt_activity_previewed", { activityId: a.activityId, activityVersionId: a.versionId, subject: a.content.subject }, { familyId: parent.familyId, req });
      const c = a.content;
      return {
        ...activitySummary(a),
        versionId: a.versionId,
        entitled,
        preview: entitled
          ? { parentPreview: c.parentPreview, materials: c.materials, noPurchaseRoute: c.noPurchaseRoute, safety: c.safety || null, optionalKit: c.optionalKit || null, accessibilityAdaptations: c.accessibilityAdaptations, shorterVersion: c.shorterVersion.description, extension: c.extension, prerequisites: c.prerequisites, steps: c.scriptSteps.length }
          : null,
      };
    },
  },
});
