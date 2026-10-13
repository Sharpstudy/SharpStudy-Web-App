import { route, str } from "@/learn-together/server/http";
import { childState } from "@/learn-together/server/sessions";
import { findParentOnlyKeys } from "@/learn-together/domain/projection";

export default route({
  auth: "device",
  handlers: {
    GET: async ({ device, req }) => {
      const state = await childState(device, str(req.query.id));
      // Defence in depth: never let a parent-only key reach a child device.
      const leaks = findParentOnlyKeys(state);
      if (leaks.length) throw new Error(`child projection leak: ${leaks.join(", ")}`);
      return state;
    },
  },
});
