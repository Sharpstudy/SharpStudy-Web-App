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
