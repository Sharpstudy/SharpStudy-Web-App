import React from "react";
import InstructorLayout from "@/components/Instructor/InstructorLayout";
import InstructorSessions from "@/components/LiveSessions/InstructorSessions";

// Access is gated server-side in _app (instructors/admins only) and again by every API call.
const Live = ({ user }) => (
	<InstructorLayout user={user} title="Live sessions" description="Schedule group classes and one-to-one slots, start them and review attendance.">
		<InstructorSessions />
	</InstructorLayout>
);

export default Live;
