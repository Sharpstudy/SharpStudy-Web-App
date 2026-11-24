import React from "react";
import FamilyShell from "@/components/Family/FamilyShell";
import ManageFamily from "@/components/Family/ManageFamily";

// Family hub: children, paired devices, pairing, family PIN, caregivers. Signed-in parents only
// (the /family prefix is guarded in pages/_app.js; every API call re-checks on the server).
const Manage = () => (
	<FamilyShell title="Family">
		<ManageFamily />
	</FamilyShell>
);

export default Manage;
