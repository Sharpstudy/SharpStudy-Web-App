// Mastery Ladder: profile picker -> PIN -> study dashboard.
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Head from "next/head";
import MasteryShell from "@/components/Mastery/MasteryShell";
import PinPad from "@/components/Mastery/PinPad";
import HabitGrid from "@/components/Mastery/HabitGrid";
import AssignmentsPanel from "@/components/Mastery/AssignmentsPanel";
import LearnerForm from "@/components/Mastery/LearnerForm";
import { StatTile, ProgressBar, EmptyState } from "@/components/ui";
import { api, getLearnerToken, getActiveLearner, setLearnerToken } from "@/lib/mastery-client/api";
import { offline, useOfflineSync } from "@/lib/mastery-client/sync";

const worksheetHref = (subject, p, ws) =>
	`/study/worksheet/?subject=${subject}&level=${encodeURIComponent(p.levelId)}&set=${encodeURIComponent(p.setId)}&ws=${ws}`;

const ProfilePicker = ({ onUnlocked, accountUserId }) => {
	const [learners, setLearners] = useState(null);
	const [chosen, setChosen] = useState(null);
	const [error, setError] = useState(null);
	const [tries, setTries] = useState(0);
	const [busy, setBusy] = useState(false);
	const [adding, setAdding] = useState(false);
	const [canCreate, setCanCreate] = useState(false);
	const [loadError, setLoadError] = useState(null);

	const load = useCallback(() => {
		api
			.get("/learners", { learner: false })
			.then((d) => { setLearners(d.learners); setCanCreate(!!d.canCreate); })
			.catch((e) => setLoadError(e.message));
	}, []);
	useEffect(load, [load]);

	const unlock = async (pin) => {
		setBusy(true);
		setError(null);
		try {
			const r = await api.post(`/learners/${chosen.id}/unlock`, { pin }, { learner: false });
			setLearnerToken(r.learnerToken, r.learner, accountUserId);
			onUnlocked();
		} catch (e) {
			setError(e.message);
			setTries((t) => t + 1);
		} finally {
			setBusy(false);
		}
	};

	if (loadError) return <p className="ml-note ml-note--danger" role="alert">{loadError}</p>;
	if (!learners) return <p className="ml-loading" role="status">Loading profiles…</p>;

	if (chosen) {
		return (
			<section className="ml-card ml-picker__pin" aria-labelledby="pin-title">
				<p className="ml-avatar-lg" aria-hidden="true">{chosen.avatar}</p>
				<h1 id="pin-title" className="ml-h2">Hi {chosen.displayName}!</h1>
				<PinPad key={tries} onComplete={unlock} disabled={busy} error={error} />
				<button type="button" className="ss-btn ss-btn--ghost" onClick={() => { setChosen(null); setError(null); }}>
					Not you? Choose another profile
				</button>
			</section>
		);
	}

	return (
		<section aria-labelledby="picker-title">
			<h1 id="picker-title" className="ml-h1">Who is studying?</h1>
			{learners.length === 0 && !adding && (
				<EmptyState
					icon="ri-user-smile-line"
					title="No learner profiles yet"
					description={canCreate ? "An adult can add a learner profile with a 4-digit PIN." : "Ask your family administrator or instructor to set up your learner profile."}
					action={canCreate ? <button type="button" className="ss-btn" onClick={() => setAdding(true)}>Add a learner</button> : undefined}
				/>
			)}
			{learners.length > 0 && (
				<ul className="ml-picker">
					{learners.map((l) => (
						<li key={l.id}>
							<button type="button" className="ml-picker__item" onClick={() => setChosen(l)}>
								<span className="ml-avatar-lg" aria-hidden="true">{l.avatar}</span>
								<span className="ml-picker__name">{l.displayName}</span>
								{l.pinLocked && <span className="ss-badge ss-badge--warning">PIN locked</span>}
							</button>
						</li>
					))}
					{canCreate && <li>
						<button type="button" className="ml-picker__item ml-picker__item--add" onClick={() => setAdding(true)}>
							<span className="ml-avatar-lg" aria-hidden="true">＋</span>
							<span className="ml-picker__name">Add learner</span>
						</button>
					</li>}
				</ul>
			)}
			{adding && canCreate && (
				<div className="ml-card">
					<h2 className="ml-h2">Add a learner</h2>
					<LearnerForm onCreated={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />
				</div>
			)}
			<p className="ml-hint">
				Grown-ups: manage profiles, goals and placement on the <Link href="/family/"><a>family dashboard</a></Link>.
			</p>
		</section>
	);
};

const SubjectCard = ({ s }) => {
	const p = s.position;
	return (
		<article className="ml-card ml-subject" aria-labelledby={`subj-${s.id}`}>
			<header className="ml-subject__head">
				<span className="ss-icon-tile" aria-hidden="true"><i className={s.icon}></i></span>
				<div>
					<h2 id={`subj-${s.id}`} className="ml-h3">{s.name}</h2>
					<p className="ml-muted">
						Level {p.levelId} · {p.levelTitle} · {p.stage}
					</p>
				</div>
			</header>
			<p className="ml-subject__set">
				<strong>{p.setTitle}</strong> — worksheet {p.worksheetNo} of {p.worksheets}
			</p>
			<ol className="ml-strip" aria-label="Worksheets in this set">
				{s.worksheets.map((w) => (
					<li key={w.no} className={`ml-strip__item is-${w.state}`}>
						{w.state === "locked" ? (
							<span aria-label={`Worksheet ${w.no}, locked`}>
								<i className="ri-lock-line" aria-hidden="true"></i>
							</span>
						) : (
							<Link href={worksheetHref(s.id, p, w.no)}>
								<a aria-label={`Worksheet ${w.no}, ${w.state === "done" ? "completed — practise again" : "current"}`}>
									{w.state === "done" ? <i className="ri-check-line" aria-hidden="true"></i> : w.no}
								</a>
							</Link>
						)}
					</li>
				))}
			</ol>
			<ProgressBar value={Math.round(s.progress * 100)} label={`${s.name} ladder progress`} />
			<p className="ml-muted ml-small">{Math.round(s.progress * 100)}% of the available {s.name} ladder</p>
			<Link href={worksheetHref(s.id, p, p.worksheetNo)}>
				<a className="ss-btn ss-btn--block">
					<i className="ri-play-fill" aria-hidden="true"></i> Start worksheet {p.worksheetNo}
				</a>
			</Link>
		</article>
	);
};

const StudyHome = ({ onSwitch }) => {
	const [home, setHome] = useState(null);
	const [error, setError] = useState(null);
	const learnerId = home && home.learner.id;
	const sync = useOfflineSync(learnerId);
	const resume = learnerId ? offline.loadInProgress(learnerId) : null;

	const load = useCallback(() => {
		api
			.get("/study/home")
			.then(setHome)
			.catch((e) => {
				if (e.status === 401) onSwitch();
				else setError(e.message);
			});
	}, [onSwitch]);
	useEffect(load, [load, sync.pending]);

	if (error) return <p className="ml-note ml-note--danger" role="alert">{error}</p>;
	if (!home) return <p className="ml-loading" role="status">Loading your ladder…</p>;

	const goalMet = home.todayCount >= home.dailyGoal;
	return (
		<>
			<header className="ml-study-head">
				<div className="ml-row">
					<span className="ml-avatar-lg" aria-hidden="true">{home.learner.avatar}</span>
					<div>
						<h1 className="ml-h1">Hi {home.learner.displayName}!</h1>
						{(home.learner.gradeLabel || home.learner.age != null) && (
							<p className="ml-muted ml-small">
								{home.learner.gradeLabel}
								{home.learner.gradeLabel && home.learner.age != null ? " · " : ""}
								{home.learner.age != null ? `age ${home.learner.age}` : ""}
							</p>
						)}
						<p className="ml-muted">{goalMet ? "Daily goal done — amazing!" : `${home.dailyGoal - home.todayCount} more worksheet${home.dailyGoal - home.todayCount === 1 ? "" : "s"} to reach today's goal.`}</p>
					</div>
				</div>
				<button type="button" className="ss-btn ss-btn--secondary ss-btn--sm" onClick={onSwitch}>
					<i className="ri-user-shared-line" aria-hidden="true"></i> Switch learner
				</button>
			</header>

			{(sync.pending > 0 || !sync.online) && (
				<p className="ml-note ml-note--warning" role="status">
					{sync.online
						? `${sync.pending} finished worksheet${sync.pending === 1 ? " is" : "s are"} waiting to sync${sync.syncing ? "…" : "."}`
						: "You are offline. Finished worksheets are saved on this device and will sync when you reconnect."}
				</p>
			)}
			{sync.lastFailed && sync.lastFailed.length > 0 && (
				<p className="ml-note ml-note--danger" role="alert">
					{sync.lastFailed.length} saved worksheet{sync.lastFailed.length === 1 ? "" : "s"} could not be recorded ({sync.lastFailed[0].error.message}).
				</p>
			)}

			<div className="ml-stats">
				<StatTile icon="ri-flag-2-line" tone={goalMet ? "success" : "primary"} value={`${home.todayCount}/${home.dailyGoal}`} label="Today's goal" />
				<StatTile icon="ri-fire-line" tone="accent" value={home.streak.current} label={`Day streak (best ${home.streak.longest})`} />
				<StatTile icon="ri-star-fill" tone="accent" value={home.totalStars} label="Stars earned" />
			</div>

			{home.assignments && home.assignments.length > 0 && <AssignmentsPanel items={home.assignments} counts={home.assignmentCounts} mode="learner" />}

			{resume && resume.sheetMeta && (
				<div className="ml-card ml-resume">
					<p>
						<strong>Unfinished worksheet:</strong> {resume.sheetMeta.setTitle}, worksheet {resume.sheetMeta.worksheetNo} ({resume.answered} of {resume.total} answered)
					</p>
					<Link href={worksheetHref(resume.sheetMeta.subject, resume.sheetMeta, resume.sheetMeta.worksheetNo)}>
						<a className="ss-btn ss-btn--sm">Resume</a>
					</Link>
				</div>
			)}

			{home.subjects.length === 0 ? (
				<EmptyState icon="ri-book-2-line" title="No subjects switched on" description="Ask an adult to switch on a subject from the family dashboard." />
			) : (
				<div className="ml-subjects">
					{home.subjects.map((s) => (
						<SubjectCard key={s.id} s={s} />
					))}
				</div>
			)}

			<section className="ml-card" aria-labelledby="habit-title">
				<h2 id="habit-title" className="ml-h3">Your last 21 days</h2>
				<HabitGrid days={home.habit} goal={home.dailyGoal} />
			</section>
		</>
	);
};

const StudyPage = ({ user }) => {
	const [hasLearner, setHasLearner] = useState(null);
	useEffect(() => {
		// A learner unlocked under a different account (or left behind by an old login) is dropped;
		// the server enforces the same rule on every request.
		const active = getActiveLearner();
		if (getLearnerToken() && user && user.id && (!active || active.accountUserId !== user.id)) setLearnerToken(null);
		setHasLearner(!!getLearnerToken());
	}, [user]);
	const switchLearner = useCallback(() => {
		setLearnerToken(null);
		setHasLearner(false);
	}, []);

	return (
		<MasteryShell user={user}>
			<Head>
				<title>Study — SharpStudy Mastery Ladder</title>
			</Head>
			<div className="ss-container ml-page">
				{hasLearner === null ? null : hasLearner ? (
					<StudyHome onSwitch={switchLearner} />
				) : (
					<ProfilePicker accountUserId={user && user.id} onUnlocked={() => setHasLearner(true)} />
				)}
			</div>
		</MasteryShell>
	);
};

export default StudyPage;
