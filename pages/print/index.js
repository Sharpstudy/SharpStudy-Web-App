// Printable worksheets. Sheets come from /api/mastery/print, which uses the
// same deterministic generator as the study player and refuses locked
// worksheets and unauthorised answer keys.
import React, { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import MasteryShell from "@/components/Mastery/MasteryShell";
import { RichText, VerticalSum } from "@/components/Mastery/QuestionView";
import Scene from "@/components/Mastery/Scene";
import { useCurriculum } from "@/components/Mastery/PlacementDialog";
import { PageHeader } from "@/components/ui";
import { api } from "@/lib/mastery-client/api";
import { isUnlocked } from "@/lib/mastery/curriculum";

const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

const PrintedSheet = ({ sheet, name, prefilled }) => (
	<article className="ml-sheet">
		<header className="ml-sheet__head">
			<div>
				<p className="ml-sheet__brand">SharpStudy · Mastery Ladder</p>
				<h2>
					{sheet.levelId} — {sheet.setTitle}
				</h2>
				<p>
					Worksheet {sheet.worksheetNo} of {sheet.worksheets}
					{prefilled && <strong> · ANSWER COPY</strong>}
				</p>
			</div>
			<dl className="ml-sheet__fields">
				<div>
					<dt>Name</dt>
					<dd>{name || ""}</dd>
				</div>
				<div>
					<dt>Date</dt>
					<dd />
				</div>
				<div>
					<dt>Time taken</dt>
					<dd />
				</div>
				<div>
					<dt>Score</dt>
					<dd>&nbsp;&nbsp;&nbsp;&nbsp;/ {sheet.problems.length}</dd>
				</div>
			</dl>
		</header>
		<ol className="ml-sheet__questions">
			{sheet.problems.map((p) => (
				<li key={p.index} className="ml-sheet__q">
					{p.scene && <Scene scene={p.scene} />}
					{p.layout && p.layout.kind === "vertical" ? <VerticalSum layout={p.layout} answerLine={false} /> : (
						<p className="ml-sheet__prompt">
							<RichText value={p.prompt} />
						</p>
					)}
					{p.choices && (
						<ul className="ml-sheet__choices">
							{p.choices.map((c) => (
								<li key={c.label}>
									<span className="ml-sheet__bubble">{c.label}</span> {c.text}
								</li>
							))}
						</ul>
					)}
					{p.inputs ? (
						<div className="ml-sheet__parts">
							{p.inputs.map((inp, i) => (
								<span key={i}>
									{inp.label} = <span className="ml-sheet__line" />
								</span>
							))}
						</div>
					) : (
						<p className="ml-sheet__answer">
							Answer: <span className="ml-sheet__line">{prefilled ? <span className="ml-sheet__filled">{p.filled}</span> : null}</span> {p.unit || ""}
						</p>
					)}
					{prefilled && p.inputs && <p className="ml-sheet__filled">{p.filled}</p>}
				</li>
			))}
		</ol>
		<footer className="ml-sheet__foot">
			<span>Target time: {fmt(sheet.targetSeconds)}</span>
			<span>
				Seed {sheet.seedCode} · {sheet.levelId}/{sheet.setId}/{sheet.worksheetNo}/v{sheet.variant}
			</span>
		</footer>
	</article>
);

const AnswerKey = ({ sheet }) => (
	<article className="ml-sheet ml-sheet--key">
		<header className="ml-sheet__head">
			<div>
				<p className="ml-sheet__brand">SharpStudy · Answer key</p>
				<h2>
					{sheet.levelId} — {sheet.setTitle} · Worksheet {sheet.worksheetNo}
				</h2>
			</div>
		</header>
		<ol className="ml-sheet__key">
			{sheet.answerKey.map((k) => (
				<li key={k.index}>
					<strong>{k.answer}</strong>
					{k.solution && k.solution.length > 0 && <span className="ml-sheet__sol"> — {k.solution.join(" ")}</span>}
				</li>
			))}
		</ol>
		<footer className="ml-sheet__foot">
			<span>For adults only</span>
			<span>Seed {sheet.seedCode}</span>
		</footer>
	</article>
);

const PrintPage = ({ user }) => {
	const curriculum = useCurriculum();
	const [learners, setLearners] = useState(null);
	const [perms, setPerms] = useState([]);
	const [learnerId, setLearnerId] = useState("");
	const [positions, setPositions] = useState({});
	const [opt, setOpt] = useState({ subject: "math", levelId: "", setId: "", worksheetNo: 1, copies: 1, answerKey: false, prefilled: false, showName: true, name: "", paper: "A4" });
	const [result, setResult] = useState(null);
	const [error, setError] = useState(null);
	const [busy, setBusy] = useState(false);
	const set = (k, v) => setOpt((o) => ({ ...o, [k]: v }));
	const printAny = perms.includes("curriculum.print_any");

	useEffect(() => {
		api.get("/learners", { learner: false }).then((d) => {
			setLearners(d.learners);
			if (d.learners[0]) setLearnerId(d.learners[0].id);
		}).catch((e) => setError(e.message));
		api.get("/me", { learner: false }).then((d) => setPerms((d.account && d.account.permissions) || [])).catch(() => {});
	}, []);

	// Learner's current position per subject decides what is unlocked.
	useEffect(() => {
		if (!learnerId) return setPositions({});
		const l = learners && learners.find((x) => x.id === learnerId);
		if (l) set("name", l.displayName);
		api.get(`/learners/${learnerId}`, { learner: false }).then((d) => {
			const pos = {};
			d.subjects.filter((s) => s.active && s.position).forEach((s) => (pos[s.id] = s.position));
			setPositions(pos);
		}).catch((e) => setError(e.message));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [learnerId]);

	const subj = curriculum && curriculum.find((s) => s.id === opt.subject);
	const current = positions[opt.subject];
	const allowed = (levelId, setId, ws) => !learnerId ? printAny : !!current && isUnlocked(opt.subject, { levelId, setId, worksheetNo: ws }, current);
	const levels = useMemo(
		() => (subj ? subj.levels.filter((l) => l.ready && l.sets.some((s) => s.ready && allowed(l.id, s.id, 1))) : []),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[subj, current, learnerId, printAny]
	);
	const level = levels.find((l) => l.id === opt.levelId) || levels[levels.length - 1];
	const sets = level ? level.sets.filter((s) => s.ready && allowed(level.id, s.id, 1)) : [];
	const chosenSet = sets.find((s) => s.id === opt.setId) || sets[sets.length - 1];
	const worksheets = chosenSet ? Array.from({ length: chosenSet.worksheets }, (_, i) => i + 1).filter((n) => allowed(level.id, chosenSet.id, n)) : [];
	const wsNo = worksheets.includes(Number(opt.worksheetNo)) ? Number(opt.worksheetNo) : worksheets[worksheets.length - 1];

	const generate = async (e) => {
		e.preventDefault();
		setBusy(true);
		setError(null);
		setResult(null);
		try {
			const r = await api.post(
				"/print",
				{ learnerId: learnerId || undefined, subject: opt.subject, levelId: level.id, setId: chosenSet.id, worksheetNo: wsNo, copies: Number(opt.copies), answerKey: opt.answerKey, prefilled: opt.prefilled },
				{ learner: false }
			);
			setResult(r);
		} catch (err) {
			setError(err.message);
		} finally {
			setBusy(false);
		}
	};

	const name = opt.showName ? opt.name : "";
	return (
		<MasteryShell user={user} className={`ml-print-page ml-paper-${opt.paper}`}>
			<Head>
				<title>Print worksheets — SharpStudy</title>
				<style>{`@page { size: ${opt.paper === "Letter" ? "letter" : "A4"}; margin: 12mm; }`}</style>
			</Head>
			<div className="ml-print-controls">
				<PageHeader title="Print worksheets" description="Printed sheets match the study player exactly. Only unlocked worksheets can be printed." crumbs={[{ href: "/", label: "Home" }, { label: "Print" }]} />
				<div className="ss-container ss-container--wide ml-page">
					<form className="ml-card ml-form" onSubmit={generate}>
						<div className="ml-grid-3">
							<div className="ml-field">
								<label htmlFor="pr-learner">Learner</label>
								<select id="pr-learner" className="ml-text" value={learnerId} onChange={(e) => setLearnerId(e.target.value)}>
									{(learners || []).map((l) => (
										<option key={l.id} value={l.id}>
											{l.displayName}
										</option>
									))}
									{printAny && <option value="">No learner (teacher copy — any worksheet)</option>}
								</select>
							</div>
							<div className="ml-field">
								<label htmlFor="pr-subject">Subject</label>
								<select id="pr-subject" className="ml-text" value={opt.subject} onChange={(e) => setOpt((o) => ({ ...o, subject: e.target.value, levelId: "", setId: "" }))}>
									{(curriculum || []).map((s) => (
										<option key={s.id} value={s.id}>
											{s.name}
										</option>
									))}
								</select>
							</div>
							<div className="ml-field">
								<label htmlFor="pr-level">Level</label>
								<select id="pr-level" className="ml-text" value={level ? level.id : ""} onChange={(e) => setOpt((o) => ({ ...o, levelId: e.target.value, setId: "" }))} disabled={!levels.length}>
									{levels.map((l) => (
										<option key={l.id} value={l.id}>
											{l.id} — {l.title}
										</option>
									))}
								</select>
							</div>
							<div className="ml-field">
								<label htmlFor="pr-set">Set</label>
								<select id="pr-set" className="ml-text" value={chosenSet ? chosenSet.id : ""} onChange={(e) => set("setId", e.target.value)} disabled={!sets.length}>
									{sets.map((s) => (
										<option key={s.id} value={s.id}>
											{s.title}
										</option>
									))}
								</select>
							</div>
							<div className="ml-field">
								<label htmlFor="pr-ws">Worksheet (unlocked)</label>
								<select id="pr-ws" className="ml-text" value={wsNo || ""} onChange={(e) => set("worksheetNo", e.target.value)} disabled={!worksheets.length}>
									{worksheets.map((n) => (
										<option key={n} value={n}>
											{n}
										</option>
									))}
								</select>
							</div>
							<div className="ml-field">
								<label htmlFor="pr-copies">Equivalent variants</label>
								<input id="pr-copies" type="number" min={1} max={6} className="ml-text ml-text--short" value={opt.copies} onChange={(e) => set("copies", e.target.value)} />
							</div>
						</div>
						<fieldset className="ml-field">
							<legend>Options</legend>
							<div className="ml-checks">
								<label className="ml-check-row"><input type="checkbox" checked={opt.answerKey} onChange={(e) => set("answerKey", e.target.checked)} /> Answer key</label>
								<label className="ml-check-row"><input type="checkbox" checked={opt.prefilled} onChange={(e) => set("prefilled", e.target.checked)} /> Prefilled answer copy</label>
								<label className="ml-check-row"><input type="checkbox" checked={opt.showName} onChange={(e) => set("showName", e.target.checked)} /> Print learner name</label>
							</div>
						</fieldset>
						<div className="ml-grid-3">
							{opt.showName && (
								<div className="ml-field">
									<label htmlFor="pr-name">Name on sheet</label>
									<input id="pr-name" className="ml-text" maxLength={40} value={opt.name} onChange={(e) => set("name", e.target.value)} />
								</div>
							)}
							<div className="ml-field">
								<label htmlFor="pr-paper">Paper</label>
								<select id="pr-paper" className="ml-text" value={opt.paper} onChange={(e) => set("paper", e.target.value)}>
									<option value="A4">A4</option>
									<option value="Letter">US Letter</option>
								</select>
							</div>
						</div>
						{learners && learners.length === 0 && !printAny && <p className="ml-note ml-note--info">Add a learner on the family dashboard to print their worksheets.</p>}
						{error && <p className="ml-note ml-note--danger" role="alert">{error}</p>}
						<div className="ml-row">
							<button type="submit" className="ss-btn" disabled={busy || !chosenSet || !wsNo}>
								Preview
							</button>
							{result && (
								<button type="button" className="ss-btn ss-btn--secondary" onClick={() => window.print()}>
									<i className="ri-printer-line" aria-hidden="true"></i> Print
								</button>
							)}
						</div>
					</form>
				</div>
			</div>
			{result && (
				<div className="ml-print-area">
					{result.sheets.map((s) => (
						<PrintedSheet key={`ws-${s.variant}`} sheet={s} name={name} />
					))}
					{opt.prefilled && result.sheets.map((s) => <PrintedSheet key={`pf-${s.variant}`} sheet={s} name={name} prefilled />)}
					{opt.answerKey && result.sheets.map((s) => s.answerKey && <AnswerKey key={`key-${s.variant}`} sheet={s} />)}
				</div>
			)}
		</MasteryShell>
	);
};

export default PrintPage;
