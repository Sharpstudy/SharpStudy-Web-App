import React from "react";
import StudentLayout from "@/components/Learning/StudentLayout";
import StudentSessions from "@/components/LiveSessions/StudentSessions";

const Live = ({ user }) => (
	<StudentLayout user={user} section="learning" title="Live sessions" description="Book and join live classes and one-to-one sessions for the courses you have purchased.">
		<StudentSessions />
	</StudentLayout>
);

export default Live;
