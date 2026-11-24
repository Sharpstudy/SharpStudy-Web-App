import React from "react";
import { Badge } from "@/components/ui";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/removals/reasons";

const day = (d) => (d ? new Date(d).toLocaleDateString(undefined, { dateStyle: "medium" }) : "–");

// The instructor's OWN removal requests and what the administrator decided. Read-only: a decision can't be changed here.
const RemovalRequestsPanel = ({ requests }) => {
	if (!requests || requests.length === 0) return null;
	return (
		<section className="mt-4" aria-labelledby="my-removal-requests">
			<h2 id="my-removal-requests" className="ss-subhead" style={{ marginTop: 0 }}>
				My removal requests
			</h2>
			<div className="table-responsive">
				<table className="table align-middle fs-14">
					<thead>
						<tr>
							<th scope="col">Student</th>
							<th scope="col">Reason</th>
							<th scope="col">Requested</th>
							<th scope="col">Status</th>
							<th scope="col">Administrator&apos;s note</th>
						</tr>
					</thead>
					<tbody>
						{requests.map((r) => (
							<tr key={r.id}>
								<td>{r.learnerName}</td>
								<td>
									{r.reason}
									{r.comments && <div className="ss-muted">{r.comments}</div>}
								</td>
								<td className="text-nowrap">{day(r.createdAt)}</td>
								<td>
									<Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
									{r.decidedAt && <div className="ss-muted">{day(r.decidedAt)}</div>}
								</td>
								<td>{r.decisionNote || <span className="ss-muted">{r.status === "pending" ? "Waiting for an administrator" : "–"}</span>}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
};

export default RemovalRequestsPanel;
