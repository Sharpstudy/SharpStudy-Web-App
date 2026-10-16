// Page chrome for Mastery Ladder screens (study, family dashboard, print).
import React, { useEffect } from "react";
import { useRouter } from "next/router";
import { api } from "@/lib/mastery-client/api";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import FeedbackButton from "./FeedbackButton";

// Presence heartbeat (admin "who is online"); failures are ignored.
const usePresence = () => {
	const { asPath } = useRouter();
	useEffect(() => {
		const beat = () => api.post("/presence", { path: asPath.split("?")[0] }).catch(() => {});
		beat();
		const t = setInterval(beat, 60000);
		return () => clearInterval(t);
	}, [asPath]);
};

const MasteryShell = ({ user, children, bare, className = "" }) => {
	usePresence();
	return (
	<>
		{!bare && <Navbar user={user} />}
		<main className={`ml-shell ${className}`}>{children}</main>
		{!bare && <Footer />}
		<FeedbackButton />
	</>
	);
};

export default MasteryShell;
