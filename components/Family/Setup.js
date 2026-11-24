// Family setup. The normal path is ONE step: enter the child's parent-link code, then land on Progress (/family/).
// The Family PIN and device-pairing steps are no longer part of linking; they are only reached on purpose
// (/family/setup/?step=2 or ?step=3, from the Family page's pairing flow).
// Children are never created here: the parent links an EXISTING learner profile with a code the child shows on their own Study page.
// Resumes where the family left off (children saved? PIN set?) and never redirects away mid-flow.
import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Avatar, Icon } from "./art";
import { LinkChildForm, PictureCodeForm, ageLabel } from "./LinkChild";
import Dialog from "./Dialog";
import { PinPad } from "./controls";
import PairPanel from "./PairDevice";
import { parent } from "@/lib/family/client";
import { PARENT_HOME } from "@/lib/family/parentMode";

const Progress = ({ step, onBack }) => (
	<div className="fm-progress">
		<button type="button" className="fm-iconbtn" onClick={onBack} aria-label="Back">
			<Icon name="back" size={22} />
		</button>
		{step > 1 && (
			<>
				<div className="fm-progress__bars" role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step}>
					{[1, 2, 3].map((n) => <span key={n} className={n <= step ? "is-on" : ""} />)}
				</div>
				<span className="fm-progress__count">{step} of 3</span>
			</>
		)}
	</div>
);

const Setup = () => {
	const router = useRouter();
	const [data, setData] = useState(null);
	const [loadError, setLoadError] = useState(null);
	const [step, setStep] = useState(null);
	const first = useRef(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(null);
	const [linking, setLinking] = useState(false);
	const [editing, setEditing] = useState(null);
	const [pin, setPin] = useState("");

	const load = useCallback(async () => {
		try {
			const d = await parent.family();
			setData(d);
			setLoadError(null);
			if (first.current) {
				first.current = false;
				if (router.query.link === "1") {
					setStep(1);
					setLinking(true);
				} else if (!d.children.length) setStep(1);
				else if (router.query.step === "2") setStep(2);
				else if (router.query.step === "3" && d.pinSet) setStep(3);
				else router.replace(PARENT_HOME); // already linked: Progress (no PIN or pairing step)
			}
		} catch (e) {
			setLoadError(e);
		}
	}, [router]);
	useEffect(() => {
		if (router.isReady) load();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [router.isReady]);

	if (loadError) {
		return (
			<div className="fm-card" role="alert">
				<p className="fm-error"><Icon name="alert" size={18} /> {loadError.message}</p>
				<button type="button" className="fm-btn fm-btn--secondary" onClick={load}>Try again</button>
			</div>
		);
	}
	if (!data || step === null) return <p className="fm-muted" role="status">Loading…</p>;

	const kids = data.children;

	const savePin = async () => {
		setBusy(true);
		setError(null);
		try {
			await parent.setPin({ pin });
			setPin("");
			await load();
			setStep(3);
		} catch (e) {
			setError(e.message);
			setPin("");
		} finally {
			setBusy(false);
		}
	};

	const back = () => {
		setError(null);
		if (step === 1) router.push(PARENT_HOME);
		else setStep(step - 1);
	};

	if (step === 3) {
		return (
			<PairPanel
				kids={kids}
				initialIds={[kids[0].id]}
				requests={data.requests}
				onChanged={load}
				onClose={() => router.push("/family/manage/")}
				variant="page"
			/>
		);
	}

	return (
		<div className="fm-wizard">
			<Progress step={step} onBack={back} />

			{step === 1 && (
				<>
					<h1 className="fm-h1">Link your child</h1>
					<p className="fm-lead">Your child&apos;s learner profile is created by their instructor. Ask your child to sign in to their own SharpStudy account, open the Study page and choose &ldquo;Show parent link code&rdquo;. Enter the code here.</p>

					{kids.map((k) => (
						<div key={k.id} className="fm-card fm-mini">
							<Avatar avatar={k.avatar} size={48} />
							<div>
								<strong>{k.nickname}</strong>
								<p className="fm-muted">{k.ageBand ? `Ages ${ageLabel(k.ageBand)} · ` : ""}{k.pictureCode ? "Picture code on" : "No picture code yet"}</p>
							</div>
							<button type="button" className="fm-linkbtn" onClick={() => setEditing(k)} aria-label={`Picture code for ${k.nickname}`}>Picture code</button>
						</div>
					))}

					{linking || !kids.length ? (
						<div className="fm-card fm-card--focus">
							<LinkChildForm idPrefix="fm-setup-link" onLinked={async () => { setLinking(false); router.push(PARENT_HOME); }} onCancel={kids.length ? () => setLinking(false) : undefined} />
						</div>
					) : (
						<button type="button" className="fm-dashed" onClick={() => setLinking(true)}>
							<Icon name="plus" size={18} /> Link another child
						</button>
					)}

					<div className="fm-wizard__foot">
						<button type="button" className="fm-btn fm-btn--primary fm-btn--block" onClick={() => router.push(PARENT_HOME)} disabled={!kids.length}>Continue</button>
					</div>
				</>
			)}

			{step === 2 && (
				<>
					<h1 className="fm-h1">Set a family PIN</h1>
					<p className="fm-lead">Your kids never need it. You&apos;ll use it on their device to leave child mode or unpair it.</p>
					{data.pinSet ? (
						<div className="fm-card fm-center">
							<p><Icon name="check" size={20} /> Your family PIN is already set.</p>
							<p className="fm-muted">You can change it any time in Family.</p>
						</div>
					) : (
						<>
							<PinPad value={pin} onChange={setPin} onSubmit={savePin} disabled={busy} />
							<p className="fm-muted fm-center">4 to 6 digits · avoid birthdays</p>
							{error && <p className="fm-error fm-center" role="alert"><Icon name="alert" size={18} /> {error}</p>}
						</>
					)}
					<div className="fm-wizard__foot">
						{data.pinSet ? (
							<button type="button" className="fm-btn fm-btn--primary fm-btn--block" onClick={() => setStep(3)}>Continue</button>
						) : (
							<button type="button" className="fm-btn fm-btn--primary fm-btn--block" onClick={savePin} disabled={busy || pin.length < 4}>{busy ? "Saving…" : "Save PIN"}</button>
						)}
					</div>
				</>
			)}

			<Dialog open={!!editing} onClose={() => setEditing(null)} title={editing ? `Picture code for ${editing.nickname}` : ""}>
				{editing && <PictureCodeForm key={editing.id} child={editing} onCancel={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} idPrefix="fm-se" />}
			</Dialog>
		</div>
	);
};

export default Setup;
