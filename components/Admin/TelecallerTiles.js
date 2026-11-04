import React, { useEffect, useState } from "react";
import axios from "axios";
import { StatTile } from "@/components/ui";

// Telecaller counters for the admin dashboard. Admin only (the API re-checks the role). A failure renders nothing, so the
// rest of the dashboard is never affected.
const TelecallerTiles = () => {
	const [s, setS] = useState(null);
	useEffect(() => {
		let live = true;
		axios.get("/api/admin/telecallers/summary").then((r) => live && setS(r.data)).catch(() => {});
		return () => {
			live = false;
		};
	}, []);
	if (!s) return null;
	return (
		<>
			<StatTile icon="ri-file-list-3-line" tone="info" value={s.applications.pending} label="Pending telecaller applications" />
			<StatTile icon="ri-question-line" tone="accent" value={s.applications.more_info_requested} label="Telecaller info requested" />
			<StatTile icon="ri-customer-service-2-line" tone="success" value={s.telecallers.active} label="Active telecallers" />
		</>
	);
};

export default TelecallerTiles;
