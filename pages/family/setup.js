import React from "react";
import FamilyShell from "@/components/Family/FamilyShell";
import Setup from "@/components/Family/Setup";

// Three-step onboarding: Who's learning -> Family PIN -> Pair a device.
const SetupPage = () => (
	<FamilyShell title="Set up your family" bare>
		<Setup />
	</FamilyShell>
);

export default SetupPage;
