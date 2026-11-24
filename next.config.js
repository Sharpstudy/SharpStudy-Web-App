/** @type {import('next').NextConfig} */
const path = require("path");
const nextConfig = {
  reactStrictMode: true,
  trailingSlash: true,
  output: "standalone",
  sassOptions: {
    includePaths: [path.join(__dirname, "styles")],
  },
  optimizeFonts: false,
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  // Files in public/ are not content-hashed, so they get a bounded lifetime (default was max-age=0: revalidated on every visit).
  // Images/video: 1 day, then served stale for up to a week while the browser re-checks in the background; fonts: 30 days.
  // The bookstore UI was retired (Stage A). Every book page redirects away; the /api/books routes are untouched until Stage B.
  // Temporary (307) redirects so they can be changed without browser caching. trailingSlash is on, so these match with or without "/".
  async redirects() {
    return [
      { source: "/books", destination: "/courses/", permanent: false },
      { source: "/books/:path*", destination: "/courses/", permanent: false },
      { source: "/learning/my-books", destination: "/courses/", permanent: false },
      { source: "/learning/my-books/:path*", destination: "/courses/", permanent: false },
      { source: "/admin/books", destination: "/admin/", permanent: false },
      { source: "/admin/books/:path*", destination: "/admin/", permanent: false },
    ];
  },
  async headers() {
    const cache = (value) => [{ key: "Cache-Control", value }];
    return [
      { source: "/images/:path*", headers: cache("public, max-age=86400, stale-while-revalidate=604800") },
      { source: "/video/:path*", headers: cache("public, max-age=86400, stale-while-revalidate=604800") },
      { source: "/fonts/:path*", headers: cache("public, max-age=2592000, stale-while-revalidate=2592000") },
    ];
  },
  env: {
    BASE_URL: process.env.BASE_URL,
    CLOUD_NAME: "dvoomq0ii",
    UPLOAD_PRESETS: "zhphafwx",
    CLOUDINARY_URL:
      "https://api.cloudinary.com/v1_1/dvoomq0ii/image/upload",
    CLOUDINARY_VIDEO_URL:
      "https://api.cloudinary.com/v1_1/dvoomq0ii/video/upload",
    CLOUDINARY_ZIP_URL:
      "https://api.cloudinary.com/v1_1/dvoomq0ii/raw/upload",
    // Publishable key is public by design; it still comes from the environment.
    STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY,
  },
};

module.exports = nextConfig;
