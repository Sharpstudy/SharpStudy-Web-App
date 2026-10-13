import { route } from "@/learn-together/server/http";
import bcrypt from "bcrypt";
import { z } from "zod";
import { ChildProfile } from "@/learn-together/server/models";
import { requireDeviceChild, setActiveChild } from "@/learn-together/server/auth";
import { HttpError } from "@/learn-together/server/errors";

export default route({
  auth: "device",
  handlers: {
    POST: async ({ device, req, res }) => {
      const body = z.object({ childProfileId: z.string().uuid(), pictureCode: z.array(z.string().max(20)).length(3).optional() }).parse(req.body || {});
      requireDeviceChild(device, body.childProfileId);
      const kid = await ChildProfile.findByPk(body.childProfileId);
      if (!kid) throw new HttpError(404, "Not found");
      if (kid.pictureCodeHash) {
        if (kid.pictureCodeLockedUntil && new Date(kid.pictureCodeLockedUntil).getTime() > Date.now()) throw new HttpError(429, "Let's take a little break, then try again.", "locked");
        if (!body.pictureCode) throw new HttpError(401, "Picture code needed", "picture_code_required");
        const ok = await bcrypt.compare(body.pictureCode.join("-"), kid.pictureCodeHash);
        if (!ok) {
          const fails = (kid.pictureCodeFailed || 0) + 1;
          await kid.update({ pictureCodeFailed: fails >= 5 ? 0 : fails, pictureCodeLockedUntil: fails >= 5 ? new Date(Date.now() + 5 * 60000) : null });
          throw new HttpError(401, "Not quite. Try again!", "picture_code_wrong");
        }
        await kid.update({ pictureCodeFailed: 0, pictureCodeLockedUntil: null });
      }
      setActiveChild(req, res, device.deviceId, kid.id);
      return { ok: true };
    },
  },
});
