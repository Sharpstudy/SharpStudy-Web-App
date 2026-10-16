import React, { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import toast from "react-hot-toast";
import InstructorLayout from "@/components/Instructor/InstructorLayout";
import { Field } from "@/components/ui/Form";
import { Button } from "@/components/ui";

// Your own teaching profile (the API only ever edits the signed-in account).
const Profile = ({ user }) => {
	const [p, setP] = useState(null);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	useEffect(() => {
		axios.get("/api/instructor/profile").then((r) => setP(r.data.profile)).catch((e) => setError((e.response && e.response.data && e.response.data.message) || "Could not load your profile."));
	}, []);
	const bind = (k) => ({ value: (p && p[k]) || "", onChange: (e) => setP((x) => ({ ...x, [k]: e.target.value })) });
	const save = async (e) => {
		e.preventDefault();
		setSaving(true);
		try {
			setP((await axios.put("/api/instructor/profile", p)).data.profile);
			toast.success("Profile saved.");
		} catch (err) {
			toast.error((err.response && err.response.data && err.response.data.message) || "Could not save.");
		} finally {
			setSaving(false);
		}
	};
	return (
		<InstructorLayout user={user} title="Teaching profile" description="What students see about you.">
			{error && <div className="ss-alert ss-alert--danger" role="alert">{error}</div>}
			{p && (
				<form className="ia-form" onSubmit={save}>
					<div className="ia-photo">
						{/* eslint-disable-next-line @next/next/no-img-element */}
						{p.profile_photo ? <img className="ss-avatar ss-avatar--lg" src={p.profile_photo} alt="Your profile photo" /> : null}
						<Link href="/profile/photo/"><a>Change profile photo</a></Link>
					</div>
					<div className="ia-grid">
						<Field label="Professional title" maxLength={120} {...bind("designation")} />
						<Field label="Location" maxLength={120} {...bind("location")} />
						<Field label="Biography" className="ia-wide"><textarea className="form-control" rows={5} maxLength={3000} {...bind("bio")} /></Field>
						<Field label="Qualifications" className="ia-wide"><textarea className="form-control" rows={3} maxLength={2000} {...bind("qualifications")} /></Field>
						<Field label="Teaching subjects" maxLength={300} {...bind("subjects")} />
						<Field label="Teaching languages" maxLength={200} {...bind("languages")} />
						<Field label="Relevant experience" className="ia-wide"><textarea className="form-control" rows={3} maxLength={3000} {...bind("experience")} /></Field>
						<Field label="Website" type="url" placeholder="https://" {...bind("website")} />
						<Field label="LinkedIn" type="url" placeholder="https://" {...bind("linkedin")} />
					</div>
					<div className="ia-actions"><Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save profile"}</Button></div>
				</form>
			)}
		</InstructorLayout>
	);
};

export default Profile;
