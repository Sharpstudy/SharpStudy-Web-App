import cookie from "js-cookie";
import Router from "next/router";
import jwt from 'jsonwebtoken';

export const handleLogin = (t, routeNext) => {
  cookie.set("edmy_users_token", t);
  if (routeNext.query && routeNext.query.next) {
    Router.push(routeNext.query.next);
  } else {
    Router.push("/");
  }
};

export const handleLogout = () => {
  cookie.remove("edmy_users_token");
  Router.push("/");
};

export const destroyCookie = () => {
  cookie.remove("edmy_users_token");
  Router.reload("/");
};

export const redirectUser = (ctx, location) => {
  if (ctx.req) {
    ctx.res.writeHead(302, { Location: location });
    ctx.res.end();
  } else {
    Router.push({ pathname: location, query: { next: ctx.pathname } });
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
