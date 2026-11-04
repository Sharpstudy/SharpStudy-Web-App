import React from "react";
import Head from "next/head";
import TelecallerLayout from "@/components/Telecaller/TelecallerLayout";
import Dashboard from "@/components/Telecaller/Dashboard";

// /telecaller/: the telecaller dashboard. Only an admin or an account with an ACTIVE approved telecaller profile may open it. That is
// enforced twice: the page gate in pages/_app.js keeps other accounts from rendering it, and every API it calls re-reads the account
// and the telecaller profile from the database, so a deactivated telecaller is refused on their very next request.
const TelecallerHome = ({ user }) => (
	<TelecallerLayout user={user} title="Telecaller dashboard" description="Follow up on meeting requests with the rest of the team. Everyone sees every meeting; one telecaller owns each follow-up.">
		<Head>
			<title>Telecaller dashboard — SharpStudy</title>
		</Head>
		<Dashboard />
	</TelecallerLayout>
);

export default TelecallerHome;
