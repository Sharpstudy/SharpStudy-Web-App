// Student-facing Family page (/family/ for a child account: a student whose login is attached to a learner profile).
// It is only the child's side of parent linking: make a code, see who is linked. It never loads a parent dashboard or
// any progress data; the parent Progress screen is a different page for a different account.
import React from "react";
import Head from "next/head";
import StudentLayout from "@/components/Learning/StudentLayout";
import ParentLinkCode from "@/components/Family/ParentLinkCode";

const StudentFamily = ({ user }) => (
	<StudentLayout user={user} section="family">
		<Head>
			<title>Family — SharpStudy</title>
		</Head>
		<div className="ml-stack" style={{ maxWidth: 720 }}>
			<ParentLinkCode />
		</div>
	</StudentLayout>
);

export default StudentFamily;
