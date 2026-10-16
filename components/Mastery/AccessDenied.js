import React from "react";
import Link from "next/link";
import { EmptyState } from "@/components/ui";

// Shown when the server reports 401/403. The server is the source of truth;
// this screen only explains the refusal.
const AccessDenied = ({ message }) => (
	<div role="alert">
		<EmptyState
			icon="ri-shield-keyhole-line"
			title="Access denied"
			description={message || "Your account does not have permission to view this area. Ask an administrator if you need access."}
			action={
				<Link href="/">
					<a className="ss-btn ss-btn--secondary">Back to home</a>
				</Link>
			}
		/>
	</div>
);

export default AccessDenied;
