// Placement override with explicit confirmation. Choices come from the
// public curriculum; only ready sets are selectable.
import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/mastery-client/api";

let curriculumCache = null;
export const useCurriculum = () => {
	const [c, setC] = useState(curriculumCache);
	useEffect(() => {
		if (c) return;
		api.get("/curriculum", { learner: false }).then((d) => {
			curriculumCache = d.subjects;
			setC(d.subjects);
		});
	}, [c]);
	return c;
};

const PlacementDialog = ({ learnerId, learnerName, subject, current, onClose, onSaved, selfPlacement }) => {
	const curriculum = useCurriculum();
	const subj = curriculum && curriculum.find((s) => s.id === subject);
	const [levelId, setLevelId] = useState(current ? current.levelId : "");
	const [setId, setSetId] = useState(current ? current.setId : "");
	const [ws, setWs] = useState(current ? current.worksheetNo : 1);
	const [confirmed, setConfirmed] = useState(false);
	const [error, setError] = useState(null);
	const [busy, setBusy] = useState(false);

	const levels = useMemo(() => (subj ? subj.levels.filter((l) => l.ready) : []), [subj]);
	const level = levels.find((l) => l.id === levelId) || levels[0];
	const sets = level ? level.sets.filter((s) => s.ready) : [];
	const set = sets.find((s) => s.id === setId) || sets[0];

	const save = async () => {
		setBusy(true);
		setError(null);
		try {
			await api.post(
				`/learners/${learnerId}/placement`,
				{ subject, position: { levelId: level.id, setId: set.id, worksheetNo: Number(ws) }, confirm: confirmed },
				{ learner: !!selfPlacement }
			);
			onSaved();
		} catch (e) {
			setError(e.message);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="ml-modal" role="dialog" aria-modal="true" aria-labelledby="place-title">
			<div className="ml-card ml-modal__body">
				<h2 id="place-title" className="ml-h3">
					Change placement — {subj ? subj.name : subject}
				</h2>
				{!subj ? (
					<p className="ml-loading">Loading curriculum…</p>
				) : (
					<>
						<p className="ml-muted ml-small">
							Current: {current ? `${current.levelId} · ${current.setTitle} · worksheet ${current.worksheetNo}` : "not placed"}
						</p>
						<div className="ml-grid-3">
							<div className="ml-field">
								<label htmlFor="pl-level">Level</label>
								<select id="pl-level" className="ml-text" value={level ? level.id : ""} onChange={(e) => { setLevelId(e.target.value); setSetId(""); setWs(1); }}>
									{levels.map((l) => (
										<option key={l.id} value={l.id}>
											{l.id} — {l.title}
										</option>
									))}
								</select>
							</div>
							<div className="ml-field">
								<label htmlFor="pl-set">Set</label>
								<select id="pl-set" className="ml-text" value={set ? set.id : ""} onChange={(e) => { setSetId(e.target.value); setWs(1); }}>
									{sets.map((s) => (
										<option key={s.id} value={s.id}>
											{s.title}
										</option>
									))}
								</select>
							</div>
							<div className="ml-field">
								<label htmlFor="pl-ws">Worksheet</label>
								<select id="pl-ws" className="ml-text" value={ws} onChange={(e) => setWs(e.target.value)}>
									{set && Array.from({ length: set.worksheets }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
								</select>
							</div>
						</div>
						<label className="ml-check-row">
							<input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
							I understand this moves {learnerName} to a new place on the ladder. Earlier worksheets stay open for review; later ones stay locked.
						</label>
					</>
				)}
				{error && <p className="ml-note ml-note--danger" role="alert">{error}</p>}
				<div className="ml-row ml-row--end">
					<button type="button" className="ss-btn ss-btn--ghost" onClick={onClose}>
						Cancel
					</button>
					<button type="button" className="ss-btn" disabled={!confirmed || busy || !set} onClick={save}>
						Confirm placement
					</button>
				</div>
			</div>
		</div>
	);
};

export default PlacementDialog;
