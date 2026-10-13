import { route } from "@/learn-together/server/http";
import { tokenRequest } from "@/learn-together/server/realtime";
import { channels } from "@/learn-together/domain/sync";
import { notFound } from "@/learn-together/server/errors";

export default route({
  auth: "device",
  handlers: {
    GET: async ({ device }) => {
      const tr = await tokenRequest(`device:${device.deviceId}`, device.childProfileIds.map(channels.child));
      if (!tr) throw notFound("Realtime is not configured");
      return tr;
    },
  },
});
