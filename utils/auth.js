import cookie from "js-cookie";
import Router from "next/router";
import jwt from 'jsonwebtoken';
import { clearLearnerSession } from "@/lib/mastery-client/api";
import { safeNextPath } from "@/lib/books/redirect";

// `fallback` is where to go when there is no safe `?next=` (parents: /family/setup/ or /family/manage/).
export const handleLogin = (t, routeNext, fallback = "/") => {
  clearLearnerSession(); // a profile unlocked under a previous login must not follow this one
  cookie.set("edmy_users_token", t);
  // `next` is user-editable: only same-site relative paths are followed (no open redirect).
  const next = routeNext.query && safeNextPath(routeNext.query.next);
  if (next) {
    Router.push(next);
  } else {
    Router.push(safeNextPath(fallback) || "/");
  }
};

// Parent accounts: same sign-out, then the parent sign-in page (not the public home page).
export const handleParentLogout = () => {
  cookie.remove("edmy_users_token");
  clearLearnerSession();
  Router.push("/auth?for=family");
};

export const handleLogout = () => {
  cookie.remove("edmy_users_token");
  clearLearnerSession();
  Router.push("/");
};

export const destroyCookie = () => {
  cookie.remove("edmy_users_token");
  clearLearnerSession();
  Router.reload("/");
};

export const redirectUser = (ctx, location) => {
  if (ctx.req) {
    ctx.res.writeHead(302, { Location: location });
    ctx.res.end();
  } else {
    // A location that already carries its own query (e.g. "/auth?intent=instructor&next=...") is used as given.
    Router.push(location.includes("?") ? location : { pathname: location, query: { next: ctx.pathname } });
  }
};

export const slugify = (string) => {
  return string
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\-]+/g, "")
    .replace(/\-\-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
};

export async function verifyUser(req, res) {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    // Token comes from the UI or Swagger docs
    token = req.headers.authorization.split(' ')[1];

  } else if (req.headers.authorization) {
    // Token comes without the "Bearer " prefix
    token = req.headers.authorization;
  } else {
    throw new Error("Invalid or missing authorization header");
  }

  // Verify the token using the extracted token variable
  const user = jwt.verify(token, process.env.JWT_SECRET);

  return user;
}
