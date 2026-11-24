import React from "react";
import { Provider } from "react-redux";
import { useStore } from "../store";
import { parseCookies, destroyCookie } from "nookies";
import axios from "axios";
import { redirectUser } from "@/utils/auth";
import { pageAccess, isGatedPath } from "@/lib/auth/pageAccess";
import baseUrl from "@/utils/baseUrl";
import "@/utils/axiosAuth";
import "../styles/bootstrap.min.css";
import "../styles/animate.min.css";
import "../styles/boxicons.min.css";
import "../styles/flaticon.css";
import "../styles/remixicon.css";
import "../styles/nprogress.css";
import "react-accessible-accordion/dist/fancy-example.css";
import "react-tabs/style/react-tabs.css";
import "swiper/css";
import "swiper/css/bundle";
import "react-confirm-alert/src/react-confirm-alert.css";
import "@etchteam/next-pagination/dist/index.css";
import "react-loading-skeleton/dist/skeleton.css";
// Global Styles
import "../styles/style.css";
import "../styles/responsive.css";

// Dashboard
import "../styles/dashboard.css";

// SharpStudy design system (tokens, components, legacy harmonization) — keep last
import "../styles/sharpstudy/index.scss";

import Layout from "../components/_App/Layout";
import { UserProvider } from "../components/_App/UserContext";

// Everything about courses: the catalogue, course pages, categories, the cart / checkout and the whole student learning area. A visitor
// who is not signed in never gets these pages (they are redirected to the login page, with ?next= so they come back afterwards).
const COURSE_AREAS = ["/courses", "/course", "/category", "/checkout", "/learning"];
const inCourseArea = (pathname) => COURSE_AREAS.some((b) => pathname === b || pathname.startsWith(b + "/"));

function MyApp({ Component, pageProps }) {
	const store = useStore(pageProps.initialReduxState);
	return (
		<Provider store={store}>
			<UserProvider value={pageProps.user || null}>
				<Layout>
					<Component {...pageProps} />
				</Layout>
			</UserProvider>
		</Provider>
	);
}

MyApp.getInitialProps = async ({ Component, ctx }) => {
	const { edmy_users_token } = parseCookies(ctx);
	let pageProps = {};

	if (Component.getInitialProps) {
		pageProps = await Component.getInitialProps(ctx);
	}

	if (!edmy_users_token) {
		// if a user not logged in then user can't access those pages
		const isProtectedRoute =
			ctx.pathname === "/profile/basic-information" ||
			ctx.pathname === "/profile/photo" ||
			ctx.pathname === "/checkout" ||
			ctx.pathname === "/become-an-instructor" ||
			ctx.pathname === "/become-a-telecaller" ||
			ctx.pathname === "/learning/my-courses" ||
			ctx.pathname === "/instructor/courses" ||
			ctx.pathname === "/admin" ||
			ctx.pathname === "/admin/instructor" ||
			ctx.pathname === "/admin/students" ||
			ctx.pathname === "/admin/partners" ||
			ctx.pathname === "/admin/testimonials" ||
			ctx.pathname === "/admin/categories" ||
			ctx.pathname === "/checkout" ||
			ctx.pathname === "/learning/wishlist" ||
			inCourseArea(ctx.pathname) ||
			isGatedPath(ctx.pathname) ||
			// Mastery Ladder (APIs enforce authorisation; this only redirects to sign-in)
			ctx.pathname.startsWith("/study") ||
			ctx.pathname.startsWith("/family") ||
			ctx.pathname.startsWith("/print") ||
			ctx.pathname.startsWith("/admin/mastery") ||
			ctx.pathname.startsWith("/admin/meetings");

		if (isProtectedRoute) {
			// "Become an Instructor" / "Become a Telecaller" keep their intent: the sign-up screen explains the two steps
			// and, after the account exists, returns to the application (an ordinary account until an admin approves).
			const applyIntent = {
				"/become-an-instructor": "/auth?intent=instructor&next=%2Fbecome-an-instructor%2F",
				"/become-a-telecaller": "/auth?intent=telecaller&next=%2Fbecome-a-telecaller%2F",
			};
			// The login page returns the visitor to where they were going (`next` is only ever followed when it is a same-site path).
			const back = inCourseArea(ctx.pathname) ? `/auth?next=${encodeURIComponent(ctx.asPath || ctx.pathname)}` : null;
			redirectUser(ctx, applyIntent[ctx.pathname] || back || "/auth");
		}
	} else {
		// if a user logged in then user can't access those pages
		const ifLoggedIn =
			// /reset-password is deliberately NOT here: someone who is signed in must still be able to use a reset link.
			ctx.pathname === "/auth";
		if (ifLoggedIn) {
			redirectUser(ctx, "/");
		}

		try {
			const payload = { headers: { Authorization: edmy_users_token } };
			const url = `${baseUrl}/api/users/update`;
			const response = await axios.get(url, payload);
			const user = response && response.data.user;

			if (!user) {
				destroyCookie(ctx, "edmy_users_token");
				redirectUser(ctx, "/auth");
			}
			pageProps.user = user;
			// Role-gated screens (admin, instructor) never render for accounts without the role.
			const redirectTo = user && pageAccess(ctx.pathname, user);
			if (redirectTo) redirectUser(ctx, redirectTo);
		} catch (err) {
			destroyCookie(ctx, "edmy_users_token");
			// redirectUser(ctx, "/");
		}
	}
	return {
		pageProps,
	};
};

export default MyApp;
