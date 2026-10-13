import { route } from "@/learn-together/server/http";
import { z } from "zod";
import { track } from "@/learn-together/server/analytics";

export default route({
  auth: "device",
  handlers: {
    POST: async ({ device, req }) => {
      const b = z
        .object({ name: z.enum(["lt_launch_received", "lt_step_sync", "lt_realtime_reconnect"]), latencyMs: z.number().int().min(0).max(600000).optional(), transport: z.enum(["ably", "polling"]).optional() })
        .parse(req.body || {});
      await track(b.name, { latencyMs: b.latencyMs ?? null, transport: b.transport ?? null }, { familyId: device.familyId, req });
      return { ok: true };
    },
  },
});
