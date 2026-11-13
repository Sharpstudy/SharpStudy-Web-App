import React, { useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Field } from "@/components/ui/Form";
import { REASONS, COMMENT_MAX, MIN_TEXT } from "@/lib/removals/reasons";

// "Request Removal": the instructor only ASKS. An administrator decides; nothing is removed here.
const RemovalRequestDialog = ({ student, onClose, onDone }) => {
	const [reason, setReason] = useState("");
	const [comments, setComments] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const needsText = reason === "other";
	const valid = Boolean(reason) && (!needsText || comments.trim().length >= MIN_TEXT);

	const submit = async () => {
		if (!valid) return;
		setBusy(true);
		setError("");
		try {
			await axios.post("/api/instructor/student-removals", { learnerId: student.learnerId, reasonCode: reason, comments });
			toast.success("Request sent. It is now pending approval.");
			onDone();
		} catch (e) {
			setError((e.response && e.response.data && e.response.data.message) || "Could not send the request. Please try again.");
		} finally {
			setBusy(false);
		}
	};

	return (
		<ConfirmDialog open title="Request removal of this student" confirmLabel="Submit request" busy={busy} confirmDisabled={!valid} onConfirm={submit} onCancel={() => !busy && onClose()}>
			<p className="mb-2">
				<strong>{student.name}</strong>
				<br />
				{student.email || <span className="ss-muted">No linked account email</span>}
			</p>
			<p className="ss-muted fs-14">
				This only asks an administrator to remove <strong>your</strong> link to this student. Their account, profile, progress and worksheets are kept, and other instructors are not affected.
			</p>
			<Field label="Reason for removal (required)">
				<select className="form-select" value={reason} onChange={(e) => setReason(e.target.value)} required>
					<option value="">Select a reason…</option>
					{REASONS.map((r) => (
						<option key={r.code} value={r.code}>
							{r.label}
						</option>
					))}
				</select>
			</Field>
			<Field label={needsText ? "Please explain (required)" : "Additional comments (optional)"}>
				<textarea className="form-control" rows={3} maxLength={COMMENT_MAX} value={comments} onChange={(e) => setComments(e.target.value)} />
			</Field>
			{error && (
				<div className="ss-field-error" role="alert">
					{error}
				</div>
			)}
		</ConfirmDialog>
	);
};

export default RemovalRequestDialog;
