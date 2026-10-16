// Parent / instructor dashboard. Every figure comes from /api/mastery
// (persisted attempts and daily activity); the server enforces who may view,
// place or administer each learner — buttons here only mirror those rights.
import React, { useCallback, useEffect, useRef, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import MasteryShell from "@/components/Mastery/MasteryShell";
import HabitGrid from "@/components/Mastery/HabitGrid";
import ActivityChart from "@/components/Mastery/ActivityChart";
import LearnerForm, { ProfileFields, profilePayload } from "@/components/Mastery/LearnerForm";
import LearnerOverview from "@/components/Mastery/LearnerOverview";
import AssignmentsPanel from "@/components/Mastery/AssignmentsPanel";
import AssignWorksheet from "@/components/Mastery/AssignWorksheet";
import NotificationList from "@/components/Notifications/NotificationList";
import PlacementDialog from "@/components/Mastery/PlacementDialog";
import { StatTile, ProgressBar, EmptyState, PageHeader } from "@/components/ui";
import { api, headers } from "@/lib/mastery-client/api";

const pct = (x) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const fmtDur = (ms) => {
	const s = Math.round(ms / 1000);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const fmtDate = (d) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Never");
const OUTCOME_TEXT = {
	"next-worksheet": "Advanced",
	"next-set": "Next set",
	"next-level": "Next level",
	"subject-complete": "Completed ladder",
	"repeat-worksheet": "Repeat",
	"restart-set": "Restart set",
	review: "Review",
};

const Section = ({ title, children, id, actions }) => (
	<section className="ml-card" aria-labelledby={id}>
		<div className="ml-card__head">
			<h2 id={id} className="ml-h3">
				{title}
			</h2>
			{actions}
		</div>
		{children}
	</section>
);

const useAction = (onDone) => {
	const [msg, setMsg] = useState(null);
	const [busy, setBusy] = useState(false);
	const running = useRef(false);
	const run = async (fn, okText) => {
		if (running.current) return; // ignore repeated submissions while one is in flight
		running.current = true;
		setBusy(true);
		setMsg(null);
		try {
			await fn();
			setMsg({ tone: "success", text: okText });
			onDone && onDone();
			return true;
		} catch (e) {
			setMsg({ tone: "danger", text: e.message });
			return false;
		} finally {
			running.current = false;
			setBusy(false);
		}
	};
	const node = msg ? (
		<p className={`ml-note ml-note--${msg.tone}`} role={msg.tone === "danger" ? "alert" : "status"}>
			{msg.text}
		</p>
	) : null;
	return [run, node, busy];
};

const SettingsCard = ({ dash, reload }) => {
	const l = dash.learner;
	const [form, setForm] = useState({ dailyGoal: l.dailyGoal, reminderTime: l.reminderTime || "", timeZone: l.timeZone });
	const [run, note] = useAction(reload);
	const download = async () => {
		const res = await fetch(`/api/mastery/learners/${l.id}/calendar/`, { headers: headers({ learner: false }) });
		if (!res.ok) return;
		const blob = await res.blob();
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = "sharpstudy-reminder.ics";
		a.click();
		URL.revokeObjectURL(a.href);
	};
	return (
		<Section title="Goals & reminders" id="settings-title">
			<form
				className="ml-form"
				onSubmit={(e) => {
					e.preventDefault();
					run(() => api.patch(`/learners/${l.id}`, { dailyGoal: Number(form.dailyGoal), reminderTime: form.reminderTime || null, timeZone: form.timeZone }, { learner: false }), "Saved.");
				}}
			>
				<div className="ml-grid-3">
					<div className="ml-field">
						<label htmlFor="st-goal">Daily goal (worksheets)</label>
						<input id="st-goal" type="number" min={1} max={20} className="ml-text" value={form.dailyGoal} disabled={!dash.access.place} onChange={(e) => setForm({ ...form, dailyGoal: e.target.value })} />
					</div>
					<div className="ml-field">
						<label htmlFor="st-rem">Daily reminder time</label>
						<input id="st-rem" type="time" className="ml-text" value={form.reminderTime} disabled={!dash.access.place} onChange={(e) => setForm({ ...form, reminderTime: e.target.value })} />
					</div>
					<div className="ml-field">
						<label htmlFor="st-tz">Family time zone</label>
						<input id="st-tz" className="ml-text" value={form.timeZone} disabled={!dash.access.place} onChange={(e) => setForm({ ...form, timeZone: e.target.value })} />
					</div>
				</div>
				<div className="ml-row ml-row--wrap">
					{dash.access.place && (
						<button type="submit" className="ss-btn ss-btn--sm">
							Save
						</button>
					)}
					<button type="button" className="ss-btn ss-btn--secondary ss-btn--sm" onClick={download}>
						<i className="ri-calendar-event-line" aria-hidden="true"></i> Add daily reminder to calendar (.ics)
					</button>
				</div>
				<p className="ml-hint">Streaks and daily goals use days in this time zone. The calendar file repeats every day at the reminder time (4:00 pm if not set).</p>
				{note}
			</form>
		</Section>
	);
};

// Grade, age / date of birth and guardian contact. Shown only to adults with placement rights; the
// date of birth and contact come from the server only for them (dash.profile).
const ProfileCard = ({ dash, reload }) => {
	const l = dash.learner;
	const p = dash.profile || {};
	const [form, setForm] = useState({
		grade: l.grade || "",
		ageMode: p.birthDate ? "dob" : "age",
		age: l.age == null ? "" : String(l.age),
		birthDate: p.birthDate || "",
		contactName: p.contactName || "",
		contactPhone: p.contactPhone || "",
		contactEmail: p.contactEmail || "",
	});
	const [run, note] = useAction(reload);
	const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
	if (!dash.profile) return null;
	return (
		<Section title="Profile" id="profile-title">
			<form
				className="ml-form"
				onSubmit={(e) => {
					e.preventDefault();
					const body = { ...profilePayload(form), grade: form.grade || null };
					run(() => api.patch(`/learners/${l.id}`, body, { learner: false }), "Profile saved.");
				}}
			>
				<ProfileFields form={form} set={set} idPrefix="pf" />
				<div className="ml-row">
					<button type="submit" className="ss-btn ss-btn--sm">Save profile</button>
				</div>
				{note}
			</form>
		</Section>
	);
};

const ShareCard = ({ dash }) => {
	const [email, setEmail] = useState("");
	const [run, note] = useAction();
	const [mailto, setMailto] = useState(null);
	useEffect(() => {
		api.get(`/learners/${dash.learner.id}/share`, { learner: false }).then((s) => setMailto(`mailto:?subject=${encodeURIComponent(s.subject)}&body=${encodeURIComponent(s.text)}`)).catch(() => {});
	}, [dash.learner.id, dash.stats.worksheets]);
	return (
		<Section title="Share progress" id="share-title">
			<form
				className="ml-row ml-row--wrap"
				onSubmit={(e) => {
					e.preventDefault();
					run(() => api.post(`/learners/${dash.learner.id}/share`, { email }, { learner: false }), `Progress summary sent to ${email}.`);
				}}
			>
				<label htmlFor="sh-email" className="ss-sr-only">
					Email address
				</label>
				<input id="sh-email" type="email" required className="ml-text" placeholder="teacher@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
				<button type="submit" className="ss-btn ss-btn--sm">
					Send summary
				</button>
				{mailto && (
					<a className="ss-btn ss-btn--ghost ss-btn--sm" href={mailto}>
						Open in my email app
					</a>
				)}
			</form>
			{note}
		</Section>
	);
};

const AccessCard = ({ dash, reload }) => {
	const l = dash.learner;
	const [pin, setPin] = useState("");
	const [gEmail, setGEmail] = useState("");
	const [relation, setRelation] = useState("instructor");
	const [run, note] = useAction(reload);
	return (
		<Section title="Access & safety" id="access-title">
			<div className="ml-stack">
				<div>
					<label className="ml-check-row">
						<input
							type="checkbox"
							checked={l.adultMode}
							onChange={(e) => run(() => api.post(`/learners/${l.id}/adult-mode`, { enabled: e.target.checked }, { learner: false }), e.target.checked ? "Adult mode on." : "Adult mode off.")}
						/>
						<span>
							<strong>Adult learner mode</strong> — lets {l.displayName} change their own placement. Only you can switch this.
						</span>
					</label>
				</div>
				<form
					className="ml-row ml-row--wrap"
					onSubmit={(e) => {
						e.preventDefault();
						run(() => api.post(`/learners/${l.id}/pin`, { pin }, { learner: false }), "PIN changed.").then(() => setPin(""));
					}}
				>
					<label htmlFor="ac-pin">New 4-digit PIN</label>
					<input id="ac-pin" className="ml-text ml-text--short" type="password" inputMode="numeric" maxLength={4} pattern="\d{4}" required value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
					<button type="submit" className="ss-btn ss-btn--secondary ss-btn--sm">
						Reset PIN
					</button>
					{l.pinLocked && <span className="ss-badge ss-badge--warning">Locked after wrong PINs — a reset unlocks it</span>}
				</form>
				<div>
					<h3 className="ml-h4">Other adults with access</h3>
					{dash.guardians.length === 0 ? (
						<p className="ml-muted ml-small">Only you.</p>
					) : (
						<ul className="ml-list">
							{dash.guardians.map((g) => (
								<li key={g.userId} className="ml-row">
									<span>
										{g.name || g.email} <span className="ss-badge">{g.relation}</span>
									</span>
									<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={() => run(() => api.del(`/learners/${l.id}/guardians`, { userId: g.userId }, { learner: false }), "Access removed.")}>
										Remove
									</button>
								</li>
							))}
						</ul>
					)}
					<form
						className="ml-row ml-row--wrap"
						onSubmit={(e) => {
							e.preventDefault();
							run(() => api.post(`/learners/${l.id}/guardians`, { email: gEmail, relation }, { learner: false }), "Access granted.").then(() => setGEmail(""));
						}}
					>
						<label htmlFor="ac-g" className="ss-sr-only">
							Their SharpStudy email
						</label>
						<input id="ac-g" type="email" required className="ml-text" placeholder="Their SharpStudy account email" value={gEmail} onChange={(e) => setGEmail(e.target.value)} />
						<select className="ml-text ml-text--short" value={relation} onChange={(e) => setRelation(e.target.value)} aria-label="Relation">
							<option value="instructor">Instructor (view &amp; place)</option>
							<option value="parent">Parent (full access)</option>
						</select>
						<button type="submit" className="ss-btn ss-btn--secondary ss-btn--sm">
							Give access
						</button>
					</form>
				</div>
				{note}
			</div>
		</Section>
	);
};

const DangerCard = ({ dash, reload, onRemoved }) => {
	const l = dash.learner;
	const [resetSubject, setResetSubject] = useState("");
	const [resetText, setResetText] = useState("");
	const [removeText, setRemoveText] = useState("");
	const [run, note, busy] = useAction();
	return (
		<Section title="Danger zone" id="danger-title">
			<div className="ml-stack">
				<form
					className="ml-stack"
					onSubmit={(e) => {
						e.preventDefault();
						run(() => api.post(`/learners/${l.id}/reset`, { subject: resetSubject || null, confirmText: resetText }, { learner: false }), "Progress reset.").then(() => {
							setResetText("");
							reload();
						});
					}}
				>
					<p>
						<strong>Reset progress</strong> deletes worksheet attempts and moves the learner back to the start{resetSubject ? "" : " of every subject (habit history is cleared too)"}.
					</p>
					<div className="ml-row ml-row--wrap">
						<select className="ml-text ml-text--short" value={resetSubject} onChange={(e) => setResetSubject(e.target.value)} aria-label="Subject to reset">
							<option value="">All subjects</option>
							{dash.subjects.map((s) => (
								<option key={s.id} value={s.id}>
									{s.name}
								</option>
							))}
						</select>
						<input className="ml-text" aria-label={`Type ${l.displayName} to confirm`} placeholder={`Type "${l.displayName}" to confirm`} value={resetText} onChange={(e) => setResetText(e.target.value)} />
						<button type="submit" className="ss-btn ss-btn--danger ss-btn--sm" disabled={busy || resetText !== l.displayName}>
							Reset progress
						</button>
					</div>
				</form>
				<form
					className="ml-stack"
					onSubmit={(e) => {
						e.preventDefault();
						run(() => api.del(`/learners/${l.id}`, { confirmText: removeText }, { learner: false }), "Learner removed.").then((ok) => ok && onRemoved());
					}}
				>
					<p>
						<strong>Remove learner</strong> permanently deletes {l.displayName}&apos;s profile and all of their progress.
					</p>
					<div className="ml-row ml-row--wrap">
						<input className="ml-text" aria-label={`Type ${l.displayName} to confirm removal`} placeholder={`Type "${l.displayName}" to confirm`} value={removeText} onChange={(e) => setRemoveText(e.target.value)} />
						<button type="submit" className="ss-btn ss-btn--danger ss-btn--sm" disabled={busy || removeText !== l.displayName}>
							Remove learner
						</button>
					</div>
				</form>
				{note}
			</div>
		</Section>
	);
};

const LearnerDashboard = ({ learnerId, onRemoved, canAssign, students }) => {
	const [dash, setDash] = useState(null);
	const [error, setError] = useState(null); // first load failed: nothing to show
	const [refreshError, setRefreshError] = useState(null); // a later refresh failed: keep the last data, say so
	const [refreshing, setRefreshing] = useState(false);
	const [placing, setPlacing] = useState(null);
	const [assigning, setAssigning] = useState(false);
	const [run, note] = useAction();

	const load = useCallback(() => {
		setRefreshing(true);
		return api
			.get(`/learners/${learnerId}`, { learner: false })
			.then((d) => {
				setDash(d);
				setError(null);
				setRefreshError(null);
			})
			.catch((e) => (setRefreshError(e.message), setError((cur) => cur)))
			.finally(() => setRefreshing(false));
	}, [learnerId]);
	useEffect(() => {
		// switching learner: forget the previous one's data before loading this one's
		setDash(null);
		setError(null);
		setRefreshError(null);
		load();
	}, [load]);
	// Pick up a worksheet the learner just finished: refresh every 30 s and when the tab regains focus.
	useEffect(() => {
		const tick = () => !document.hidden && load();
		const t = setInterval(tick, 30000);
		document.addEventListener("visibilitychange", tick);
		return () => {
			clearInterval(t);
			document.removeEventListener("visibilitychange", tick);
		};
	}, [load]);
	useEffect(() => {
		if (refreshError && !dash) setError(refreshError);
	}, [refreshError, dash]);

	if (error) return <p className="ml-note ml-note--danger" role="alert">{error}</p>;
	if (!dash) return <p className="ml-loading" role="status">Loading dashboard…</p>;
	const l = dash.learner;

	return (
		<div className="ml-stack">
			<header className="ml-study-head">
				<div className="ml-row">
					<span className="ml-avatar-lg" aria-hidden="true">{l.avatar}</span>
					<div>
						<h2 className="ml-h2">{l.displayName}</h2>
						<p className="ml-muted ml-small">
							{l.gradeLabel || "Grade not set"}{l.age != null && ` · age ${l.age}`} · Last practised: {fmtDate(dash.stats.lastPractisedAt)} · {dash.stats.daysPractised} day{dash.stats.daysPractised === 1 ? "" : "s"} practised
							{l.adultMode && " · Adult mode"}
						</p>
					</div>
				</div>
				<Link href="/print/">
					<a className="ss-btn ss-btn--secondary ss-btn--sm">
						<i className="ri-printer-line" aria-hidden="true"></i> Print worksheets
					</a>
				</Link>
			</header>

			<div className="ml-stats ml-stats--6">
				<StatTile icon="ri-flag-2-line" tone={dash.todayCount >= dash.dailyGoal ? "success" : "primary"} value={`${dash.todayCount}/${dash.dailyGoal}`} label="Today's goal" />
				<StatTile icon="ri-fire-line" tone="accent" value={dash.streak.current} label={`Streak (best ${dash.streak.longest})`} />
				<StatTile icon="ri-star-fill" tone="accent" value={dash.totalStars} label="Stars" />
				<StatTile icon="ri-file-list-3-line" value={dash.stats.worksheets} label="Worksheets" />
				<StatTile icon="ri-focus-3-line" value={pct(dash.stats.avgAccuracy)} label="First-try accuracy" />
				<StatTile icon="ri-time-line" value={`${Math.round(dash.stats.totalSeconds / 60)} min`} label="Time practised" />
			</div>

			{assigning && canAssign && (
				<AssignWorksheet
					students={students}
					preselect={[l.id]}
					onCancel={() => setAssigning(false)}
					onDone={() => {
						setAssigning(false);
						load();
					}}
				/>
			)}
			<AssignmentsPanel
				items={dash.assignments}
				counts={dash.assignmentCounts}
				mode="adult"
				canManage={canAssign && dash.access.place}
				onChanged={load}
				lastUpdateAt={dash.lastUpdateAt}
				stale={dash.lastUpdateAt ? `last activity ${fmtDate(dash.lastUpdateAt)}` : null}
				refreshing={refreshing}
				onRefresh={load}
				error={refreshError ? `Could not refresh: ${refreshError}` : null}
			/>
			{canAssign && dash.access.place && !assigning && (
				<div className="ml-row">
					<button type="button" className="ss-btn ss-btn--sm" onClick={() => setAssigning(true)}>
						<i className="ri-send-plane-line" aria-hidden="true"></i> Assign a worksheet
					</button>
				</div>
			)}

			<Section title="Subjects & placement" id="subj-title">
				<div className="ss-table-wrap">
					<table className="ml-table">
						<thead>
							<tr>
								<th scope="col">Subject</th>
								<th scope="col">Enrolled</th>
								<th scope="col">Level</th>
								<th scope="col">Set · worksheet</th>
								<th scope="col">Ladder progress</th>
								<th scope="col">
									<span className="ss-sr-only">Actions</span>
								</th>
							</tr>
						</thead>
						<tbody>
							{dash.subjects.map((s) => (
								<tr key={s.id}>
									<th scope="row">{s.name}</th>
									<td>
										<input
											type="checkbox"
											aria-label={`${s.name} enrolment`}
											checked={s.active}
											disabled={!dash.access.place}
											onChange={(e) => run(() => api.post(`/learners/${l.id}/enrolment`, { subject: s.id, active: e.target.checked }, { learner: false }).then(load), "Saved.")}
										/>
									</td>
									<td>{s.position ? `${s.position.levelId} — ${s.position.levelTitle}` : "–"}</td>
									<td>{s.position ? `${s.position.setTitle} · ${s.position.worksheetNo}/${s.position.worksheets}` : "–"}</td>
									<td style={{ minWidth: 120 }}>
										<ProgressBar value={Math.round(s.progress * 100)} label={`${s.name} progress`} />
										<span className="ml-small ml-muted">{Math.round(s.progress * 100)}%</span>
									</td>
									<td>
										{dash.access.place && s.active && (
											<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={() => setPlacing(s)}>
												Change placement
											</button>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				{note}
			</Section>

			<div className="ml-grid-2">
				<Section title="Habit — last 21 days" id="habit-title">
					<HabitGrid days={dash.habit} goal={dash.dailyGoal} />
				</Section>
				<section className="ml-card">
					<ActivityChart charts={dash.charts} />
				</section>
			</div>

			<Section title="Needs more practice" id="support-title">
				{dash.needsSupport.length === 0 ? (
					<p className="ml-muted">
						{dash.attemptsConsidered < 2
							? "Not enough worksheets completed yet to show insights. Areas appear after a few attempts."
							: "Nothing flagged. Areas show here when a worksheet needs repeat attempts, recent accuracy falls below the mastery bar or many hints are used."}
					</p>
				) : (
					<ul className="ml-list">
						{dash.needsSupport.map((a) => (
							<li key={a.setId}>
								<strong>{a.subjectName}: {a.setTitle}</strong> (worksheet {a.worksheetNo}) — {a.reasons.join("; ")}{" "}
								<Link href={`/study/worksheet/?subject=${a.subject}&level=${encodeURIComponent(a.levelId)}&set=${encodeURIComponent(a.setId)}&ws=${a.worksheetNo}`}>
									<a>Practise this</a>
								</Link>
							</li>
						))}
					</ul>
				)}
			</Section>

			<Section title="Recent attempts" id="recent-title">
				{dash.recent.length === 0 ? (
					<p className="ml-muted">No worksheets yet.</p>
				) : (
					<div className="ss-table-wrap">
						<table className="ml-table">
							<thead>
								<tr>
									<th scope="col">When</th>
									<th scope="col">Worksheet</th>
									<th scope="col">First-try</th>
									<th scope="col">Time / target</th>
									<th scope="col">Stars</th>
									<th scope="col">Result</th>
									<th scope="col">Hints</th>
								</tr>
							</thead>
							<tbody>
								{dash.recent.map((a) => (
									<tr key={a.attemptId}>
										<td>{fmtDate(a.completedAt)}</td>
										<td>
											{a.levelId} · {a.setId} · #{a.worksheetNo}
										</td>
										<td>
											{a.correctFirst}/{a.total}
										</td>
										<td>
											{fmtDur(a.durationMs)} / {fmtDur(a.targetSeconds * 1000)}
										</td>
										<td aria-label={`${a.stars} stars`}>{"★".repeat(a.stars) || "–"}</td>
										<td>{OUTCOME_TEXT[a.outcome] || a.outcome}</td>
										<td>{a.hintsUsed}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</Section>

			<div className="ml-grid-2">
				<SettingsCard dash={dash} reload={load} />
				<ShareCard dash={dash} />
			</div>
			<ProfileCard key={`${l.id}-${l.grade}-${l.age}`} dash={dash} reload={load} />
			{!dash.access.admin && !dash.access.place && (
				<p className="ml-note" role="note">Placement, access and learner settings are managed by this learner&apos;s family administrator or instructor.</p>
			)}
			{dash.access.admin && <AccessCard dash={dash} reload={load} />}
			{dash.access.admin && <DangerCard dash={dash} reload={load} onRemoved={onRemoved} />}

			{placing && (
				<PlacementDialog
					learnerId={l.id}
					learnerName={l.displayName}
					subject={placing.id}
					current={placing.position}
					onClose={() => setPlacing(null)}
					onSaved={() => {
						setPlacing(null);
						load();
					}}
				/>
			)}
		</div>
	);
};

const FamilyPage = ({ user }) => {
	const router = useRouter();
	// ?learner=<id>: admins/support (learners.manage_all) opening any learner.
	const requested = typeof router.query.learner === "string" ? router.query.learner : null;
	const [learners, setLearners] = useState(null);
	const [selected, setSelected] = useState(null);
	const [adding, setAdding] = useState(false);
	const [canCreate, setCanCreate] = useState(false);
	const [error, setError] = useState(null);
	const [students, setStudents] = useState([]);
	const canAssign = !!user && (user.role === "instructor" || user.role === "admin");

	const load = useCallback((selectId) => {
		api
			.get("/learners", { learner: false })
			.then((d) => {
				setLearners(d.learners);
				setCanCreate(!!d.canCreate);
				setSelected((cur) => selectId || (cur && (d.learners.some((l) => l.id === cur) || cur === requested) ? cur : d.learners[0] && d.learners[0].id));
			})
			.catch((e) => setError(e.message));
	}, [requested]);
	useEffect(() => load(), [load]);
	useEffect(() => {
		if (requested) setSelected(requested);
	}, [requested]);
	const external = selected && learners && !learners.some((l) => l.id === selected);

	return (
		<MasteryShell user={user}>
			<Head>
				<title>Family dashboard — SharpStudy</title>
			</Head>
			<PageHeader
				title="Family dashboard"
				description="Learner progress, habits and settings for the Mastery Ladder."
				crumbs={[{ href: "/", label: "Home" }, { label: "Family dashboard" }]}
				actions={
					canCreate ? (
						<button type="button" className="ss-btn ss-btn--sm" onClick={() => setAdding(true)}>
							<i className="ri-user-add-line" aria-hidden="true"></i> Add learner
						</button>
					) : undefined
				}
			/>
			<div className="ss-container ss-container--wide ml-page">
				{error && <p className="ml-note ml-note--danger" role="alert">{error}</p>}
				{adding && canCreate && (
					<section className="ml-card">
						<h2 className="ml-h3">Add a learner</h2>
						<LearnerForm
							onCreated={(l) => {
								setAdding(false);
								load(l.id);
							}}
							onCancel={() => setAdding(false)}
						/>
					</section>
				)}
				{external && <LearnerDashboard key={selected} learnerId={selected} onRemoved={() => router.push("/admin/mastery/?tab=learners")} />}
				{learners && learners.length === 0 && !adding && !external && (
					<EmptyState
						icon="ri-parent-line"
						title="No learners yet"
						description={canCreate ? "Add a learner profile to start the Mastery Ladder." : "Your account cannot create learner profiles. Ask an administrator for family access."}
						action={canCreate ? <button type="button" className="ss-btn" onClick={() => setAdding(true)}>Add learner</button> : undefined}
					/>
				)}
				{learners && learners.length > 0 && !external && (
					<>
						<NotificationList limit={4} />
						<LearnerOverview selected={selected} onSelect={setSelected} refreshKey={learners.map((l) => l.id).join(",")} onLoaded={(d) => setStudents(d.learners)} />
						{selected && <LearnerDashboard key={selected} learnerId={selected} canAssign={canAssign} students={students} onRemoved={() => load()} />}
					</>
				)}
			</div>
		</MasteryShell>
	);
};

export default FamilyPage;
