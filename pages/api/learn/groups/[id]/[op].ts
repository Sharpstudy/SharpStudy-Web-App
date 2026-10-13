import { route, str } from "@/learn-together/server/http";
import { z } from "zod";
import {
  acknowledgeHelp,
  act,
  childHelp,
  childReady,
  childRespond,
  parentDeviceActor,
  recordCheck,
  recordMisconception,
  recordReflection,
  moveChildToParentDevice,
} from "@/learn-together/server/sessions";
import { HttpError } from "@/learn-together/server/errors";

const child = z.object({ childProfileId: z.string().uuid() });

export default route({
  auth: "parent",
  handlers: {
    POST: async ({ parent, req }) => {
      const id = str(req.query.id);
      const body = req.body || {};
      switch (str(req.query.op)) {
        case "action":
          return act(parent, id, body);
        case "check":
          await recordCheck(parent, id, body);
          return { ok: true };
        case "misconception":
          await recordMisconception(parent, id, body);
          return { ok: true };
        case "reflect":
          await recordReflection(parent, id, body);
          return { ok: true };
        case "help-ack":
          return acknowledgeHelp(parent, id, z.object({ helpId: z.string().uuid() }).parse(body).helpId);
        case "use-this-device":
          return moveChildToParentDevice(parent, id, child.parse(body).childProfileId);
        // Single-device mode: the child answers on the parent's device.
        case "respond":
          return childRespond(await parentDeviceActor(parent, child.parse(body).childProfileId), id, body, req);
        case "ready":
          return childReady(await parentDeviceActor(parent, child.parse(body).childProfileId), id, child.parse(body).childProfileId);
        case "help":
          return childHelp(await parentDeviceActor(parent, child.parse(body).childProfileId), id, child.parse(body).childProfileId);
        default:
          throw new HttpError(404, "Not found");
      }
    },
  },
});
