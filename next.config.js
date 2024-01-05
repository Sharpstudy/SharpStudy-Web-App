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
    // JWT_SECRET: "asdfghjklnbvcxzqwertyuiopmkioprewqasderfgnujm",
    // DB_NAME_PRODUCTION: "sharpstudydb",
    // DB_PASSWORD_PROD: "sharpstudydb",
    // DB_HOSTNAME: "127.0.0.1",
    // DB_USERNAME: "root",
    // DB_PORT_PROD: 3306,
    AWS_SES_USER: "...",
    AWS_SES_PASSWORD: ".....",
    CLOUD_NAME: "dvoomq0ii",
    UPLOAD_PRESETS: "zhphafwx",
    CLOUDINARY_URL:
      "https://api.cloudinary.com/v1_1/dvoomq0ii/image/upload",
    CLOUDINARY_VIDEO_URL:
      "https://api.cloudinary.com/v1_1/dvoomq0ii/video/upload",
    CLOUDINARY_ZIP_URL:
      "https://api.cloudinary.com/v1_1/dvoomq0ii/raw/upload",
    STRIPE_SECRET_KEY: "sk_test_51MR86LFhxR0VYolQfG7Gl91HS5uQHaNkmiQI8WVr8uHT3HEor3qJaIsnW65Q5FxSeiLPB0BOmFPA2vSgv2Uj1KTm006oH9ZxHD",
    STRIPE_PUBLISHABLE_KEY: "pk_test_51MR86LFhxR0VYolQvZbXEvfZ0IWno5uFXYYVmvyE2olwhYK2hMDt6os2j3SYl5Ht4WUuTcOogQsNFjnGPNl1kSoA00tCgbSpT1",
  },
};

module.exports = nextConfig;
