import React from "react";
import { useRouter } from "next/router";
import StudentLayout from "@/components/Learning/StudentLayout";
import SessionRoom from "@/components/LiveSessions/SessionRoom";

const LiveSession = ({ user }) => {
	const { query } = useRouter();
	return (
		<StudentLayout user={user} section="learning" title="Live session">
			{query.id && <SessionRoom sessionId={query.id} backHref="/learning/live/" backLabel="All live sessions" />}
		</StudentLayout>
	);
};

export default LiveSession;
