const baseUrl =
  process.env.NODE_ENV === "production"
    ? "sharpstudy-web-app-load-balancer-995917686.ca-central-1.elb.amazonaws.com"
    // ? "http://localhost:3000"
    : "http://localhost:3000";

export default baseUrl;
