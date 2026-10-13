import { route } from "@/learn-together/server/http";
import { ChildProfile, ConceptProgress } from "@/learn-together/server/models";
import { activeChild } from "@/learn-together/server/auth";
import { lobbyForDevice } from "@/learn-together/server/sessions";
import { realtimeEnabled } from "@/learn-together/server/realtime";

const NEW_DAYS = 7;

export default route({
  auth: "device",
  handlers: {
    GET: async ({ device, req }) => {
      const [kids, progress, groups] = await Promise.all([
        ChildProfile.findAll({ where: { id: device.childProfileIds, familyId: device.familyId }, order: [["created_at", "ASC"]] }),
        ConceptProgress.findAll({ where: { childProfileId: device.childProfileIds } }),
        lobbyForDevice(device),
      ]);
      const now = Date.now();
      return {
        deviceLabel: device.label,
        realtime: realtimeEnabled(),
        activeChildId: activeChild(req, device),
        children: kids.map((k) => ({
          id: k.id,
          nickname: k.nickname,
          avatarKey: k.avatarKey,
          hasPictureCode: !!k.pictureCodeHash,
          readAloud: !!k.readAloud,
          largeText: !!k.largeText,
          reducedMotion: !!k.reducedMotion,
          // Journey: concepts explored. No counts, scores or statuses for the child.
          journey: progress
            .filter((p) => p.childProfileId === k.id && p.sessionsCount > 0)
            .map((p) => ({ conceptTag: p.conceptTag, isNew: now - new Date(p.created_at).getTime() < NEW_DAYS * 86400000 && p.sessionsCount === 1, exploredAgain: p.sessionsCount >= 2 })),
        })),
        groups,
      };
    },
  },
});
