import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import axios from "axios";
import toast from "react-hot-toast";
import { parseCookies } from "nookies";
import AdminLayout from "@/components/_App/AdminLayout";
import GeneralLoader from "@/utils/GeneralLoader";
import baseUrl from "@/utils/baseUrl";
import { Badge, Button, EmptyState } from "@/components/ui";
import ActionMenu from "@/components/ui/ActionMenu";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Field } from "@/components/ui/Form";
import { STATUS_LABEL, STATUS_TONE, MIN_TEXT, NOTE_MAX } from "@/lib/removals/reasons";

const FILTERS = [
	["pending", "Pending"],
	["approved", "Approved"],
	["rejected", "Rejected"],
];
const day = (d) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "N/A");
const msg = (e, fallback) => (e.response && e.response.data && e.response.data.message) || fallback;
const Person = ({ p, empty = "N/A" }) => (p ? <><div>{p.name}</div><div className="ss-muted">{p.email}</div></> : <span className="ss-muted">{empty}</span>);

// Administrators only (gated in _app via pageAccess; every API call re-checks the role and the database).
const RemovalRequests = ({ user }) => {
	const headers = () => ({ Authorization: parseCookies().edmy_users_token });
	const [all, setAll] = useState(null);
	const [error, setError] = useState("");
	const [filter, setFilter] = useState("pending");
	const [dialog, setDialog] = useState(null); // { kind: "details" | "approve" | "reject", request }
	const [note, setNote] = useState("");
	const [busy, setBusy] = useState(false);
	const [detail, setDetail] = useState(null);

	const load = useCallback(async () => {
		setError("");
		try {
			setAll((await axios.get(`${baseUrl}/api/admin/student-removals`, { headers: headers() })).data.requests);
		} catch (e) {
			setAll([]);
			setError(msg(e, "Could not load removal requests."));
		}
	}, []);
	useEffect(() => {
		load();
	}, [load]);

	const counts = useMemo(() => Object.fromEntries(FILTERS.map(([k]) => [k, (all || []).filter((r) => r.status === k).length])), [all]);
	const rows = useMemo(() => (all || []).filter((r) => r.status === filter), [all, filter]);

	const openDetails = async (r) => {
		setDialog({ kind: "details", request: r });
		setDetail(null);
		try {
			setDetail((await axios.get(`${baseUrl}/api/admin/student-removals/${r.id}`, { headers: headers() })).data.request);
		} catch (e) {
			setDetail(r);
		}
	};
	const close = () => {
		if (busy) return;
		setDialog(null);
		setNote("");
		setDetail(null);
	};
	const decide = async (action) => {
		setBusy(true);
		try {
			const r = await axios.patch(`${baseUrl}/api/admin/student-removals/${dialog.request.id}`, { action, note }, { headers: headers() });
			toast.success(action === "approve" ? "Approved. The instructor's link was removed." : "Request rejected.");
			setBusy(false);
			setDialog(null);
			setNote("");
			load();
			return r;
		} catch (e) {
			toast.error(msg(e, "Could not save the decision."));
			setBusy(false);
			if (e.response && e.response.status === 409) load(); // it was decided elsewhere: refresh the list
		}
	};

	const menu = (r) => {
		const items = [{ label: "View Details", icon: "ri-eye-line", onClick: () => openDetails(r) }];
		if (r.status === "pending") {
			items.push({ label: "Approve", icon: "ri-check-line", onClick: () => setDialog({ kind: "approve", request: r }) });
			items.push({ label: "Reject", icon: "ri-close-line", danger: true, onClick: () => setDialog({ kind: "reject", request: r }) });
		}
		return items;
	};

	const req = dialog && dialog.request;
	return (
		<AdminLayout user={user} title="Students" description="Registered learners.">
			<ul className="nav-style1">
				<li>
					<Link href="/admin/students/">
						<a>Students</a>
					</Link>
				</li>
				<li>
					<Link href="/admin/students/site-admins/">
						<a>Admins</a>
					</Link>
				</li>
				<li>
					<Link href="/admin/students/removal-requests/">
						<a className="active">Removal requests</a>
					</Link>
				</li>
			</ul>

			<div className="d-flex flex-wrap gap-2 mb-3" role="group" aria-label="Filter requests by status">
				{FILTERS.map(([key, label]) => (
					<Button key={key} size="sm" variant={filter === key ? "primary" : "secondary"} aria-pressed={filter === key} onClick={() => setFilter(key)}>
						{label} ({counts[key] || 0})
					</Button>
				))}
			</div>

			{error && <div className="ss-alert ss-alert--danger" role="alert">{error}</div>}
			{!all && !error && <GeneralLoader />}
			{all && !error && rows.length === 0 && <EmptyState icon="ri-user-unfollow-line" title={`No ${filter} requests`} description="Instructors can ask to remove their own link to a student; requests appear here." />}
			{all && rows.length > 0 && (
				<div className="table-responsive">
					<table className="table align-middle table-hover fs-14">
						<thead>
							<tr>
								<th scope="col">Student</th>
								<th scope="col">Requesting instructor</th>
								<th scope="col">Reason</th>
								<th scope="col">Additional comments</th>
								<th scope="col">Requested</th>
								<th scope="col">Status</th>
								<th scope="col">Actions</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((r) => (
								<tr key={r.id}>
									<td>
										<div>{r.learnerName}</div>
										<div className="ss-muted">{r.student ? r.student.email : "No linked account"}</div>
									</td>
									<td>
										<Person p={r.instructor} />
									</td>
									<td>{r.reason}</td>
									<td>
										<div className="max-300px max-height-60">{r.comments || <span className="ss-muted">N/A</span>}</div>
									</td>
									<td className="text-nowrap">{day(r.createdAt)}</td>
									<td>
										<Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
									</td>
									<td>
										<ActionMenu label={`Actions for the request about ${r.learnerName}`} items={menu(r)} />
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{dialog && dialog.kind === "details" && <Details request={detail || req} loading={!detail} onClose={close} />}

			<ConfirmDialog open={Boolean(dialog && dialog.kind === "approve")} title="Approve this removal?" confirmLabel="Approve and remove link" busy={busy} onConfirm={() => decide("approve")} onCancel={close}>
				{req && (
					<>
						<p>
							This will remove <strong>only</strong> the link between the instructor <strong>{req.instructor ? `${req.instructor.name} (${req.instructor.email})` : "—"}</strong> and the learner profile <strong>{req.learnerName}</strong>
							{req.student ? ` (account ${req.student.email})` : ""}.
						</p>
						<p className="ss-muted fs-14">
							Kept as they are: the student account, the learner profile, worksheets and assignments, progress and attempts, certificates, attendance, course enrolments, and every other instructor&apos;s or parent&apos;s link. This decision can&apos;t be changed afterwards.
						</p>
						<Field label="Note to the instructor (optional)">
							<textarea className="form-control" rows={2} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
						</Field>
					</>
				)}
			</ConfirmDialog>

			<ConfirmDialog open={Boolean(dialog && dialog.kind === "reject")} title="Reject this request?" confirmLabel="Reject request" danger busy={busy} confirmDisabled={note.trim().length < MIN_TEXT} onConfirm={() => decide("reject")} onCancel={close}>
				{req && (
					<>
						<p>
							Nothing will be removed. The instructor <strong>{req.instructor ? req.instructor.name : "—"}</strong> keeps their link to <strong>{req.learnerName}</strong> and will see your explanation.
						</p>
						<Field label="Explanation (required)">
							<textarea className="form-control" rows={3} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
						</Field>
					</>
				)}
			</ConfirmDialog>
		</AdminLayout>
	);
};

const Details = ({ request: r, loading, onClose }) => {
	useEffect(() => {
		const onKey = (e) => e.key === "Escape" && onClose();
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);
	const rows = [
		["Student profile", r.learnerName + (r.profileExists ? "" : " (profile no longer exists)")],
		["Linked student account", r.student ? `${r.student.name} (${r.student.email})` : "None"],
		["Requesting instructor", r.instructor ? `${r.instructor.name} (${r.instructor.email})` : "N/A"],
		["Reason", r.reason],
		["Additional comments", r.comments || "N/A"],
		["Requested", day(r.createdAt)],
		["Status", STATUS_LABEL[r.status]],
		...(r.status !== "pending" ? [["Decided by", r.decidedBy ? r.decidedBy.name : "N/A"], ["Decided", day(r.decidedAt)], ["Administrator's note", r.decisionNote || "N/A"]] : []),
		...(r.status === "pending" && typeof r.linkActive === "boolean" ? [["Instructor link", r.linkActive ? "Still active" : "Already removed"]] : []),
	];
	return (
		<div className="ss-confirm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
			<div className="ss-confirm__box" role="dialog" aria-modal="true" aria-labelledby="removal-details-title" style={{ maxWidth: 560, maxHeight: "90vh", overflowY: "auto" }}>
				<h2 id="removal-details-title">
					Removal request <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
				</h2>
				{loading && <p className="ss-muted">Loading…</p>}
				<dl className="row fs-14 mb-3">
					{rows.map(([k, v]) => (
						<React.Fragment key={k}>
							<dt className="col-5">{k}</dt>
							<dd className="col-7 text-break">{v}</dd>
						</React.Fragment>
					))}
				</dl>
				<div className="ss-confirm__actions">
					<button type="button" className="ss-btn" onClick={onClose} autoFocus>
						Close
					</button>
				</div>
			</div>
		</div>
	);
};

export default RemovalRequests;
