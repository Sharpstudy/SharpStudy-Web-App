import React from "react";
import { useRouter } from "next/router";
import InstructorLayout from "@/components/Instructor/InstructorLayout";
import SessionRoom from "@/components/LiveSessions/SessionRoom";

const LiveSession = ({ user }) => {
	const { query } = useRouter();
	return (
		<InstructorLayout user={user} title="Live session">
			{query.id && <SessionRoom sessionId={query.id} backHref="/instructor/live/" backLabel="All sessions" />}
		</InstructorLayout>
	);
};

export default LiveSession;
