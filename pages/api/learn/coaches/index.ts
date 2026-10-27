import { route } from "@/learn-together/server/http";
import { listCoaches } from "@/learn-together/server/coaches";

export default route({
  auth: "parent",
  handlers: {
    GET: async () => {
      return listCoaches();
    },
  },
});
