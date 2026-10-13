import { route, str } from "@/learn-together/server/http";
import { parentState } from "@/learn-together/server/sessions";
import { recommendationsFor } from "@/learn-together/server/progress";

export default route({
  auth: "parent",
  handlers: {
    GET: async ({ parent, req }) => {
      const state = await parentState(parent, str(req.query.id));
      const since = Number(req.query.since);
      if (Number.isFinite(since) && since === state.seq) return { seq: state.seq, unchanged: true };
      const recommendations =
        state.state === "ended" || state.children.some((c) => c.observation)
          ? Object.fromEntries(await Promise.all(state.children.map(async (c) => [c.childProfileId, await recommendationsFor(parent, c.childProfileId, 2)])))
          : {};
      return { ...state, recommendations };
    },
  },
});
