import React from "react";
import Head from "next/head";
import AdminLayout from "@/components/_App/AdminLayout";
import ActivityBoard from "@/components/Admin/Telecallers/ActivityBoard";

// Admin > Telecallers > Activity & Call History: every call, ownership change and follow-up status change by telecallers, with
// filters, and ownership overrides (assign / clear, with a reason). Admin only: the page gate (pages/_app.js) and AdminSideNav keep
// everyone else out, and every API call re-checks the admin role on the server.
const Activity = ({ user }) => (
	<AdminLayout user={user} title="Activity & call history" description="Telecaller call activity, customer follow-ups and ownership changes. Transferring or clearing ownership needs a reason and is recorded.">
		<Head>
			<title>Telecaller activity — SharpStudy Admin</title>
		</Head>
		<ActivityBoard />
	</AdminLayout>
);

export default Activity;
