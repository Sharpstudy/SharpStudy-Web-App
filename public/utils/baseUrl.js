// Browser: relative URLs always hit the origin the page was served from.
// Server (SSR): needs an absolute URL. BASE_URL wins (set it to
// https://sharpstudy.io once that domain is live), otherwise use the
// Vercel-provided host, otherwise localhost.
const vercelHost =
  process.env.VERCEL_ENV === "production"
    ? process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
    : process.env.VERCEL_URL;

const baseUrl =
  typeof window !== "undefined"
    ? ""
    : process.env.BASE_URL ||
      (vercelHost ? `https://${vercelHost}` : "http://localhost:3000");

export default baseUrl;
