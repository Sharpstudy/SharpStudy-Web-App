import React, { useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { parseCookies } from "nookies";
import { accountIsActive } from "@/lib/auth/accountState";
import { accountMenuItems } from "@/lib/admin/accountMenu";

import baseUrl from "@/utils/baseUrl";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Badge } from "@/components/ui";

const errMsg = (e, fallback) => (e.response && e.response.data && e.response.data.message) || fallback;
export const fullName = (u) => `${u.first_name || ""} ${u.last_name || ""}`.trim() || "Unnamed";
export const isActive = accountIsActive;

export const StatusBadge = ({ user }) => <Badge tone={isActive(user) ? "success" : "neutral"}>{isActive(user) ? "Active" : "Inactive"}</Badge>;

const RECORD_LABELS = [
	["enrolments", "Course enrolments"],
	["paidEnrolments", "Paid enrolments"],
	["progressRecords", "Course progress records"],
	["coursesOwned", "Courses owned"],
	["earnings", "Instructor earnings"],
	["bookOrders", "Book orders"],
	["learnerProfiles", "Learner profiles"],
	["assignmentsCreated", "Assignments created"],
];

const Who = ({ user }) => (
	<p>
		<strong>{fullName(user)}</strong>
		<br />
		{user.email}
	</p>
);

// Menu items + dialogs for the Students and Instructors tables. `onChanged` reloads the list.
export default function useAccountManager(onChanged) {
	const [confirm, setConfirm] = useState(null); // { kind: "deactivate" | "reactivate" | "anonymize", user }
	const [typed, setTyped] = useState("");
	const [details, setDetails] = useState(null); // { user, anonymized, records }
	const [busy, setBusy] = useState(false);

	const auth = () => ({ headers: { Authorization: parseCookies().edmy_users_token } });
	const url = (id) => `${baseUrl}/api/admin/users/${id}`;

	const openDetails = async (user) => {
		try {
			setDetails((await axios.get(url(user.id), auth())).data);
		} catch (e) {
			toast.error(errMsg(e, "Could not load account details."));
		}
	};

	const close = () => {
		if (busy) return;
		setConfirm(null);
		setTyped("");
	};

	const run = async () => {
		const { kind, user } = confirm;
		setBusy(true);
		try {
			const r =
				kind === "anonymize"
					? await axios.delete(url(user.id), { ...auth(), data: { confirmEmail: typed } })
					: await axios.patch(url(user.id), { active: kind === "reactivate" }, auth());
			toast.success(r.data.message);
			setConfirm(null);
			setTyped("");
			onChanged();
		} catch (e) {
			toast.error(errMsg(e, "Action failed. Please try again."));
		} finally {
			setBusy(false);
		}
	};

	const itemsFor = (user) =>
		accountMenuItems(user, {
			view: openDetails,
			deactivate: (u) => setConfirm({ kind: "deactivate", user: u }),
			reactivate: (u) => setConfirm({ kind: "reactivate", user: u }),
			anonymize: (u) => setConfirm({ kind: "anonymize", user: u }),
		});

	const COPY = {
		deactivate: { title: "Deactivate this account?", label: "Deactivate", text: "They will be signed out and unable to sign in. All of their progress, courses, worksheets and assignments are kept." },
		reactivate: { title: "Reactivate this account?", label: "Reactivate", text: "They will be able to sign in again with their existing password. Nothing else changes." },
		anonymize: { title: "Anonymize this account?", label: "Anonymize account", text: null },
	};
	const c = confirm && COPY[confirm.kind];

	const dialogs = (
		<>
			<ConfirmDialog
				open={Boolean(confirm)}
				title={c ? c.title : ""}
				confirmLabel={c ? c.label : "Confirm"}
				danger={confirm ? confirm.kind !== "reactivate" : false}
				busy={busy}
				confirmDisabled={confirm && confirm.kind === "anonymize" && typed.trim().toLowerCase() !== String(confirm.user.email || "").toLowerCase()}
				onConfirm={run}
				onCancel={close}
			>
				{confirm && (
					<>
						<Who user={confirm.user} />
						{c.text ? (
							<p>{c.text}</p>
						) : (
							<>
								<p>
									<strong>This is irreversible.</strong> The account&apos;s name, email, phone, photo, bio and social links will be permanently erased, the password will be destroyed, and the person will never be able to sign in or recover this account.
								</p>
								<p className="mb-1">
									<strong>Educational and financial records are retained</strong> and stay linked to the anonymized account: progress, attempts, worksheets, assignments, courses, enrolments, earnings and payment records. Nothing is deleted from the database.
								</p>
							</>
						)}
						{confirm.kind === "anonymize" && (
							<label className="d-block mt-2">
								<span className="fs-14">Type the email address to confirm</span>
								<input className="form-control mt-1" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
							</label>
						)}
					</>
				)}
			</ConfirmDialog>
			{details && <DetailsDialog data={details} onClose={() => setDetails(null)} />}
		</>
	);

	return { itemsFor, dialogs };
}

function DetailsDialog({ data, onClose }) {
	const { user, anonymized, records } = data;
	React.useEffect(() => {
		const onKey = (e) => e.key === "Escape" && onClose();
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);
	const rows = [
		["Name", fullName(user)],
		["Email", user.email],
		["Phone", user.phone || "N/A"],
		["Role", user.role],
		["Email confirmed", user.email_confirmed ? "Yes" : "No"],
		["Joined", user.created_at ? new Date(user.created_at).toLocaleDateString() : "N/A"],
		...(user.role === "instructor" ? [["Subject", user.instructor_subject || "N/A"]] : []),
	];
	return (
		<div className="ss-confirm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
			<div className="ss-confirm__box" role="dialog" aria-modal="true" aria-labelledby="acct-details-title" style={{ maxWidth: 520, maxHeight: "90vh", overflowY: "auto" }}>
				<h2 id="acct-details-title">
					Account details <StatusBadge user={user} />
				</h2>
				{anonymized && <p className="ss-muted">This account was anonymized. Personal details were removed.</p>}
				<dl className="row fs-14 mb-3">
					{rows.map(([k, v]) => (
						<React.Fragment key={k}>
							<dt className="col-5">{k}</dt>
							<dd className="col-7 text-break">{v}</dd>
						</React.Fragment>
					))}
				</dl>
				<h3 className="fs-16">Records kept with this account</h3>
				<dl className="row fs-14 mb-0">
					{RECORD_LABELS.map(([k, label]) => (
						<React.Fragment key={k}>
							<dt className="col-8">{label}</dt>
							<dd className="col-4">{records[k] === null ? "—" : records[k]}</dd>
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
}
