// getServerSideProps gates for Learn Together pages. Imported only from getServerSideProps,
// so none of this reaches the client bundle.
import type { GetServerSidePropsContext, GetServerSidePropsResult } from "next";
import { isLearnTogetherEnabled } from "./flag";
import { deviceFromCookie, parentFromToken, readCookie, type LtRole } from "./auth";

type Kind = "parent" | "admin" | "kid" | "join" | "public";

export function gate(kind: Kind, roles: LtRole[] = ["lt_editor", "lt_reviewer"]) {
  return async (ctx: GetServerSidePropsContext): Promise<GetServerSidePropsResult<Record<string, unknown>>> => {
    ctx.res.setHeader("Cache-Control", "no-store");
    if (!isLearnTogetherEnabled()) return { notFound: true };
    if (kind === "parent" || kind === "admin") {
      const next = encodeURIComponent(ctx.resolvedUrl.split("?")[0]);
      try {
        const p = await parentFromToken(readCookie(ctx.req, "edmy_users_token"), { requireFamily: false });
        if (kind === "admin" && !p.ltRoles.includes("lt_admin") && !roles.some((r) => p.ltRoles.includes(r))) return { notFound: true };
        return { props: { ltRoles: p.ltRoles } };
      } catch {
        return { redirect: { destination: `/auth?next=${next}`, permanent: false } };
      }
    }
    if (kind === "kid") {
      const d = await deviceFromCookie(ctx.req);
      if (!d) return { redirect: { destination: "/learn/join", permanent: false } };
      return { props: {} };
    }
    if (kind === "join") {
      if (await deviceFromCookie(ctx.req)) return { redirect: { destination: "/learn/kid", permanent: false } };
      return { props: {} };
    }
    return { props: {} };
  };
}
