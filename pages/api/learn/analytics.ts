import { route } from "@/learn-together/server/http";
import { z } from "zod";
import { track } from "@/learn-together/server/analytics";

const CLIENT_EVENTS = ["lt_recommendation_followed", "lt_session_resumed", "lt_realtime_reconnect", "lt_launch_failed"] as const;

export default route({
  auth: "parent",
  handlers: {
    POST: async ({ parent, req }) => {
      const body = z.object({ name: z.enum(CLIENT_EVENTS), props: z.record(z.unknown()).default({}) }).parse(req.body || {});
      await track(body.name, body.props, { familyId: parent.familyId, req });
      return { ok: true };
    },
  },
});
