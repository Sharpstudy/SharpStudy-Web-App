const baseUrl =
  process.env.NODE_ENV === "production"
    ? "sharpstudy-web-app-load-balancer-1601079994.ca-central-1.elb.amazonaws.com"
    // ? "http://localhost:3000"
    // : "http://localhost:3000";
    : "sharpstudy-web-app-load-balancer-1601079994.ca-central-1.elb.amazonaws.com";


export default baseUrl;
