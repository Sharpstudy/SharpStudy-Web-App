import React from "react";
import Link from "next/link";
import { RequestsAdmin } from "../meetings";

// Admin: Free Demo Requests. The same page as Meeting Requests (list, search, filters, details, approve / reschedule / reject, history),
// limited to requests of kind "free_demo" and with their extra fields and statistics. Access is the existing /admin gate (admin only).
const FreeDemoRequests = ({ user }) => (
	<RequestsAdmin
		user={user}
		kind="free_demo"
		notice={
			<p className="ss-muted">
				To assign a request to a telecaller, record calls or schedule a follow-up, use the <Link href="/telecaller/?kind=free_demo"><a>telecaller dashboard</a></Link> (Free Demo Requests tab).
			</p>
		}
	/>
);

export default FreeDemoRequests;
