import { route } from "@/learn-together/server/http";
import { z } from "zod";
import { verifyFamilyPin } from "@/learn-together/server/family";
import { ACTIVE_CHILD_COOKIE, DEVICE_COOKIE, clearCookie } from "@/learn-together/server/auth";
import { ChildDevice } from "@/learn-together/server/models";
import { audit } from "@/learn-together/server/audit";
import { HttpError } from "@/learn-together/server/errors";
import { rateLimit } from "@/learn-together/server/rateLimit";

export default route({
  auth: "device",
  handlers: {
    POST: async ({ device, req, res }) => {
      const b = z.object({ pin: z.string().max(6), action: z.enum(["unlock", "switch_child", "unpair"]) }).parse(req.body || {});
      await rateLimit(`pin:${device.deviceId}`, 10, 900);
      if (!(await verifyFamilyPin(device.familyId, b.pin))) throw new HttpError(401, "That PIN isn't right", "bad_pin");
      if (b.action === "switch_child") clearCookie(req, res, ACTIVE_CHILD_COOKIE);
      if (b.action === "unpair") {
        await ChildDevice.update({ revokedAt: new Date(), deviceTokenHash: null }, { where: { id: device.deviceId } });
        clearCookie(req, res, DEVICE_COOKIE);
        clearCookie(req, res, ACTIVE_CHILD_COOKIE);
        await audit({ type: "child_device", id: device.deviceId }, "device.unpaired_on_device", "lt_child_device", device.deviceId);
      }
      return { ok: true };
    },
  },
});
