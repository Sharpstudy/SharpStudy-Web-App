const baseUrl =
	process.env.NODE_ENV === "production"
		? "https://sharp-study-web-dwiseryrt-sharpstudy.vercel.app"
		: "http://localhost:3000";

export default baseUrl;
