// Parent side of linking: enter the single-use code your child shows on their own Study page, and set a child's
// secret-picture sign-in code. Parents cannot create profiles, search for children or claim one by name/e-mail:
// the server resolves the child from the code alone.
import React, { useState } from "react";
import { Icon, Picture, PICTURE_ORDER, PICTURE_STYLE } from "./art";
import { parent } from "@/lib/family/client";

export const ageLabel = (b) => (b ? b.replace("-", "–") : "");

export const LinkChildForm = ({ onLinked, onCancel, idPrefix = "fm-link" }) => {
	const [code, setCode] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(null);
	const submit = async (e) => {
		e.preventDefault();
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const r = await parent.link(code.trim());
			setCode("");
			onLinked && onLinked(r.child);
		} catch (err) {
			setError(err.message);
		} finally {
			setBusy(false);
		}
	};
	return (
		<form className="fm-form" onSubmit={submit} noValidate>
			<p className="fm-muted">
				Your child&apos;s learner profile already exists, set up by their instructor. Ask your child to sign in to their own SharpStudy account, open the
				Study page and choose &ldquo;Show parent link code&rdquo;. Then type the code here. It works once and expires 72 hours after your child makes it.
			</p>
			<div className="fm-field">
				<label className="fm-label" htmlFor={`${idPrefix}-code`}>Link code</label>
				<input
					id={`${idPrefix}-code`}
					className="fm-input"
					placeholder="ABCD-2345"
					maxLength={12}
					autoComplete="off"
					autoCapitalize="characters"
					spellCheck={false}
					value={code}
					onChange={(e) => setCode(e.target.value)}
					aria-invalid={!!error}
				/>
			</div>
			{error && <p className="fm-error" role="alert"><Icon name="alert" size={18} /> {error}</p>}
			<div className="fm-form__actions">
				{onCancel && <button type="button" className="fm-btn fm-btn--ghost" onClick={onCancel} disabled={busy}>Cancel</button>}
				<button type="submit" className="fm-btn fm-btn--primary" disabled={busy || code.trim().length < 8}>{busy ? "Linking…" : "Link child"}</button>
			</div>
		</form>
	);
};

// Three pictures the child taps to sign in on a paired device (or turn the code off).
export const PictureCodeForm = ({ child, onSaved, onCancel, idPrefix = "fm-pic" }) => {
	const [picks, setPicks] = useState([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(null);
	const save = async (picture) => {
		setBusy(true);
		setError(null);
		try {
			await parent.setPicture(child.id, picture);
			onSaved && onSaved(picture === null ? "off" : "on");
		} catch (err) {
			setError(err.message);
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="fm-form" id={idPrefix}>
			<p className="fm-muted">{child.nickname} taps these three pictures, in order, to sign in on a paired device.</p>
			<div className="fm-pictures">
				<div className="fm-pictures__slots" aria-live="polite" aria-label={`${picks.length} of 3 pictures chosen`}>
					{[0, 1, 2].map((i) => (
						<span key={i} className={`fm-pictures__slot ${picks[i] ? "is-full" : ""}`}>{picks[i] && <Picture id={picks[i]} size={28} />}</span>
					))}
					<button type="button" className="fm-linkbtn" disabled={!picks.length} onClick={() => setPicks((p) => p.slice(0, -1))}>Undo</button>
				</div>
				<div className="fm-pictures__grid">
					{PICTURE_ORDER.map((id) => (
						<button key={id} type="button" className="fm-pictures__btn" aria-label={`${PICTURE_STYLE[id].name} picture`} onClick={() => setPicks((p) => (p.length < 3 ? [...p, id] : p))} disabled={picks.length >= 3 || busy}>
							<Picture id={id} size={28} />
						</button>
					))}
				</div>
			</div>
			{error && <p className="fm-error" role="alert"><Icon name="alert" size={18} /> {error}</p>}
			<div className="fm-form__actions">
				{onCancel && <button type="button" className="fm-btn fm-btn--ghost" onClick={onCancel} disabled={busy}>Cancel</button>}
				{child.pictureCode && <button type="button" className="fm-btn fm-btn--danger-outline" onClick={() => save(null)} disabled={busy}>Turn off</button>}
				<button type="button" className="fm-btn fm-btn--primary" onClick={() => save(picks)} disabled={busy || picks.length !== 3}>{busy ? "Saving…" : "Save picture code"}</button>
			</div>
		</div>
	);
};
