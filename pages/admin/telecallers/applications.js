import React from "react";
import Head from "next/head";
import AdminLayout from "@/components/_App/AdminLayout";
import ApplicationsBoard from "@/components/Admin/Telecallers/ApplicationsBoard";

// Admin > Telecallers > Applications: pending and "more information requested" applications. Admin only: the page gate
// (pages/_app.js) and AdminSideNav keep everyone else out, and every API call re-checks the admin role on the server.
const Applications = ({ user }) => (
	<AdminLayout user={user} title="Telecaller applications" description="Review applications to become a telecaller. Approving creates an active telecaller profile; it never changes the account's role.">
		<Head>
			<title>Telecaller applications — SharpStudy Admin</title>
		</Head>
		<ApplicationsBoard view="open" />
	</AdminLayout>
);

export default Applications;
