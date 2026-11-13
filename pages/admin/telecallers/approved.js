import React from "react";
import Head from "next/head";
import AdminLayout from "@/components/_App/AdminLayout";
import MembersBoard from "@/components/Admin/Telecallers/MembersBoard";

// Admin > Telecallers > Approved Telecallers: the telecaller profiles, with activate / deactivate.
const Approved = ({ user }) => (
	<AdminLayout user={user} title="Approved telecallers" description="Everyone with a telecaller profile. Deactivating removes telecaller access immediately; the account, application and history are kept.">
		<Head>
			<title>Approved telecallers — SharpStudy Admin</title>
		</Head>
		<MembersBoard />
	</AdminLayout>
);

export default Approved;
