import React from "react";
import InstructorLayout from "@/components/Instructor/InstructorLayout";
import StudentDirectory from "@/components/Instructor/StudentDirectory";

// The instructor's student directory: students of your own courses and the learner profiles you
// manage, with progress and worksheet assignment. The API only returns people in your scope.
const Students = ({ user }) => (
	<InstructorLayout user={user} title="Students" description="Find your students, see their progress and assign worksheets.">
		<StudentDirectory />
	</InstructorLayout>
);

export default Students;
