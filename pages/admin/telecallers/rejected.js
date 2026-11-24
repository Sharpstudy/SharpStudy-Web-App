import React from "react";
import Head from "next/head";
import AdminLayout from "@/components/_App/AdminLayout";
import ApplicationsBoard from "@/components/Admin/Telecallers/ApplicationsBoard";

// Admin > Telecallers > Rejected Applications: rejected applications with every decision, message and resume version.
const Rejected = ({ user }) => (
	<AdminLayout user={user} title="Rejected applications" description="Applications that were not approved, with every decision and the full history of each attempt. Nothing is deleted.">
		<Head>
			<title>Rejected telecaller applications — SharpStudy Admin</title>
		</Head>
		<ApplicationsBoard view="rejected" />
	</AdminLayout>
);

export default Rejected;
