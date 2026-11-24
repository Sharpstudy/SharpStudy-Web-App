// Create-learner form: name, avatar, subjects, time zone, 4-digit PIN.
import React, { useMemo, useState } from "react";
import { api } from "@/lib/mastery-client/api";
import { GRADES, AGE_MIN, AGE_MAX } from "@/lib/mastery/profile";

export const AVATARS = ["🦊", "🐼", "🐯", "🐸", "🦉", "🐙", "🦄", "🐢", "🚀", "⭐", "🌈", "⚽"];
export const SUBJECT_OPTIONS = [
	{ id: "math", name: "Mathematics" },
	{ id: "english", name: "English" },
	{ id: "physics", name: "Physics" },
	{ id: "chemistry", name: "Chemistry" },
];

const browserZone = () => {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch (e) {
		return "UTC";
	}
};

// Only what was filled in is sent; the date of birth wins over an age so the two never disagree.
export const profilePayload = (f) => {
	const out = {};
	if (f.grade) out.grade = f.grade;
	if (f.ageMode === "dob" && f.birthDate) out.birthDate = f.birthDate;
	else if (f.ageMode === "age" && f.age !== "") out.age = Number(f.age);
	if (f.contactName.trim()) out.contactName = f.contactName.trim();
	if (f.contactPhone.trim()) out.contactPhone = f.contactPhone.trim();
	if (f.contactEmail.trim()) out.contactEmail = f.contactEmail.trim();
	return out;
};

// Grade, age / date of birth and optional guardian contact (shared by "Add learner" and "Edit profile").
export const ProfileFields = ({ form, set, idPrefix = "lf" }) => (
	<>
		<div className="ml-grid-2">
			<div className="ml-field">
				<label htmlFor={`${idPrefix}-grade`}>School grade</label>
				<select id={`${idPrefix}-grade`} className="ml-text" value={form.grade} onChange={(e) => set("grade", e.target.value)}>
					<option value="">Not set</option>
					{GRADES.map((g) => (
						<option key={g.code} value={g.code}>{g.label}</option>
					))}
				</select>
			</div>
			<div className="ml-field">
				<label htmlFor={`${idPrefix}-age`}>{form.ageMode === "dob" ? "Date of birth" : "Age (years)"}</label>
				{form.ageMode === "dob" ? (
					<input id={`${idPrefix}-age`} className="ml-text" type="date" value={form.birthDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => set("birthDate", e.target.value)} />
				) : (
					<input id={`${idPrefix}-age`} className="ml-text" type="number" inputMode="numeric" min={AGE_MIN} max={AGE_MAX} value={form.age} onChange={(e) => set("age", e.target.value)} />
				)}
				<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={() => set("ageMode", form.ageMode === "dob" ? "age" : "dob")}>
					{form.ageMode === "dob" ? "Enter an age instead" : "Enter a date of birth instead"}
				</button>
				<p className="ml-hint">Optional. A date of birth is only visible to adults who manage this learner; learners and other students only see the age.</p>
			</div>
		</div>
		<details className="ml-field">
			<summary>Parent or guardian contact (optional)</summary>
			<div className="ml-grid-3">
				<div className="ml-field">
					<label htmlFor={`${idPrefix}-cn`}>Name</label>
					<input id={`${idPrefix}-cn`} className="ml-text" maxLength={80} value={form.contactName} onChange={(e) => set("contactName", e.target.value)} />
				</div>
				<div className="ml-field">
					<label htmlFor={`${idPrefix}-cp`}>Phone</label>
					<input id={`${idPrefix}-cp`} className="ml-text" type="tel" maxLength={32} value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} />
				</div>
				<div className="ml-field">
					<label htmlFor={`${idPrefix}-ce`}>E-mail</label>
					<input id={`${idPrefix}-ce`} className="ml-text" type="email" maxLength={120} value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} />
				</div>
			</div>
		</details>
	</>
);

// submitFn(payload) lets other screens (e.g. the instructor Students page) send the same fields elsewhere.
const LearnerForm = ({ onCreated, onCancel, initialName = "", submitFn }) => {
	const zone = useMemo(browserZone, []);
	const [form, setForm] = useState({ displayName: initialName, avatar: AVATARS[0], pin: "", pin2: "", subjects: ["math"], dailyGoal: 1, grade: "", ageMode: "age", age: "", birthDate: "", contactName: "", contactPhone: "", contactEmail: "" });
	const [error, setError] = useState(null);
	const [busy, setBusy] = useState(false);
	const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

	const submit = async (e) => {
		e.preventDefault();
		setError(null);
		if (!/^\d{4}$/.test(form.pin)) return setError("The PIN must be exactly 4 digits.");
		if (form.pin !== form.pin2) return setError("The two PINs do not match.");
		if (form.subjects.length === 0) return setError("Choose at least one subject.");
		setBusy(true);
		try {
			const payload = {
				displayName: form.displayName,
				avatar: form.avatar,
				pin: form.pin,
				subjects: form.subjects,
				dailyGoal: Number(form.dailyGoal),
				timeZone: zone,
				...profilePayload(form),
			};
			const { learner } = submitFn ? await submitFn(payload) : await api.post("/learners", payload);
			onCreated && onCreated(learner);
		} catch (err) {
			setError(err.message);
		} finally {
			setBusy(false);
		}
	};

	return (
		<form className="ml-form" onSubmit={submit}>
			<div className="ml-field">
				<label htmlFor="lf-name">Learner name</label>
				<input id="lf-name" className="ml-text" maxLength={40} required value={form.displayName} onChange={(e) => set("displayName", e.target.value)} />
			</div>
			<fieldset className="ml-field">
				<legend>Avatar</legend>
				<div className="ml-avatars">
					{AVATARS.map((a) => (
						<button
							key={a}
							type="button"
							className={`ml-avatar-pick${form.avatar === a ? " is-selected" : ""}`}
							aria-pressed={form.avatar === a}
							onClick={() => set("avatar", a)}
						>
							<span role="img" aria-label={`Avatar ${a}`}>
								{a}
							</span>
						</button>
					))}
				</div>
			</fieldset>
			<ProfileFields form={form} set={set} />
			<fieldset className="ml-field">
				<legend>Subjects</legend>
				<div className="ml-checks">
					{SUBJECT_OPTIONS.map((s) => (
						<label key={s.id} className="ml-check-row">
							<input
								type="checkbox"
								checked={form.subjects.includes(s.id)}
								onChange={(e) => set("subjects", e.target.checked ? [...form.subjects, s.id] : form.subjects.filter((x) => x !== s.id))}
							/>
							{s.name}
						</label>
					))}
				</div>
			</fieldset>
			<div className="ml-grid-2">
				<div className="ml-field">
					<label htmlFor="lf-pin">4-digit PIN</label>
					<input id="lf-pin" className="ml-text" inputMode="numeric" pattern="\d{4}" maxLength={4} autoComplete="new-password" type="password" required value={form.pin} onChange={(e) => set("pin", e.target.value.replace(/\D/g, ""))} />
				</div>
				<div className="ml-field">
					<label htmlFor="lf-pin2">Repeat PIN</label>
					<input id="lf-pin2" className="ml-text" inputMode="numeric" pattern="\d{4}" maxLength={4} autoComplete="new-password" type="password" required value={form.pin2} onChange={(e) => set("pin2", e.target.value.replace(/\D/g, ""))} />
				</div>
			</div>
			<div className="ml-field">
				<label htmlFor="lf-goal">Daily goal (worksheets per day)</label>
				<input id="lf-goal" className="ml-text ml-text--short" type="number" min={1} max={20} value={form.dailyGoal} onChange={(e) => set("dailyGoal", e.target.value)} />
				<p className="ml-hint">Days are counted in your time zone: {zone}.</p>
			</div>
			{error && (
				<p className="ml-note ml-note--danger" role="alert">
					{error}
				</p>
			)}
			<div className="ml-row ml-row--end">
				{onCancel && (
					<button type="button" className="ss-btn ss-btn--ghost" onClick={onCancel}>
						Cancel
					</button>
				)}
				<button type="submit" className="ss-btn" disabled={busy}>
					{busy ? "Creating…" : "Create learner"}
				</button>
			</div>
		</form>
	);
};

export default LearnerForm;
