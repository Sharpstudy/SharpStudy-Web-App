// Parent dashboard: a short, read-only learning summary for each linked child. It deliberately shows no
// placement, enrolment, assignment, reset or learner-management controls — the server's /api/family/overview
// only returns the signed-in parent's own linked children, and the controls do not exist server-side for parents.
// Devices, the family PIN and linking live on /family/manage/.
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Avatar, Icon } from "./art";
import { parent } from "@/lib/family/client";

const when = (d) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not yet");
const day = (d) => (d ? new Date(d).toLocaleDateString(undefined, { dateStyle: "medium" }) : "");
const Stat = ({ value, label }) => (
	<div className="fm-pd__stat">
		<strong>{value}</strong>
		<span>{label}</span>
	</div>
);

const Child = ({ c }) => {
	const s = c.summary;
	const w = c.worksheets;
	return (
		<div className="fm-pd" aria-label={`${c.nickname}'s learning`}>
			<div className="fm-card">
				<div className="fm-child__head">
					<Avatar avatar={c.avatar} size={54} />
					<div className="fm-child__who">
						<h2 className="fm-h3">{c.nickname}</h2>
						<p className="fm-muted">{[c.gradeLabel, `Last practised: ${when(s.lastPractisedAt)}`].filter(Boolean).join(" · ")}</p>
					</div>
				</div>
			</div>
			<div className="fm-pd__stats">
				<Stat value={s.worksheetsDone} label="Worksheets done" />
				<Stat value={s.accuracy == null ? "–" : `${Math.round(s.accuracy * 100)}%`} label="First-try accuracy" />
				<Stat value={`${s.minutes} min`} label="Time practised" />
				<Stat value={w.counts.pending} label="Worksheets to do" />
			</div>
			<section className="fm-card" aria-label="Progress by subject">
				<h3 className="fm-h3">Learning progress</h3>
				{c.subjects.length === 0 ? (
					<p className="fm-muted">No subjects yet. Your child&apos;s instructor sets these up.</p>
				) : (
					c.subjects.map((x) => (
						<div key={x.id} className="fm-pd__subject">
							<strong>{x.name}</strong> <span>{x.levelTitle ? `· ${x.levelTitle}` : ""} · {x.percent}%</span>
							<div className="fm-meter" role="progressbar" aria-label={`${x.name} progress`} aria-valuenow={x.percent} aria-valuemin={0} aria-valuemax={100}>
								<span style={{ width: `${x.percent}%` }} />
							</div>
						</div>
					))
				)}
			</section>
			<div className="fm-pd__cols">
				<section className="fm-card" aria-label="Pending worksheets">
					<h3 className="fm-h3">To do ({w.counts.pending})</h3>
					{w.pending.length === 0 ? (
						<p className="fm-muted">Nothing waiting. 🎉</p>
					) : (
						<ul className="fm-pd__list">
							{w.pending.map((i) => (
								<li key={i.id} className="fm-pd__item">
									<span>
										{i.title}
										<small>{i.subjectName}{i.dueAt ? ` · due ${day(i.dueAt)}` : ""}</small>
									</span>
									{i.overdue && <span className="fm-pd__flag">Overdue</span>}
								</li>
							))}
						</ul>
					)}
				</section>
				<section className="fm-card" aria-label="Completed worksheets">
					<h3 className="fm-h3">Completed ({w.counts.completed})</h3>
					{w.completed.length === 0 ? (
						<p className="fm-muted">No assigned worksheets finished yet.</p>
					) : (
						<ul className="fm-pd__list">
							{w.completed.map((i) => (
								<li key={i.id} className="fm-pd__item">
									<span>
										{i.title}
										<small>{i.subjectName} · {day(i.completedAt)}</small>
									</span>
									{i.stars != null && <span className="fm-pd__star" aria-label={`${i.stars} stars`}>{"★".repeat(i.stars) || "–"}</span>}
								</li>
							))}
						</ul>
					)}
				</section>
			</div>
			<section className="fm-card" aria-label="Recent activity">
				<h3 className="fm-h3">Recent learning activity</h3>
				{c.recent.length === 0 ? (
					<p className="fm-muted">No worksheets practised yet.</p>
				) : (
					<ul className="fm-pd__list">
						{c.recent.map((a) => (
							<li key={a.id} className="fm-pd__item">
								<span>
									{a.worksheet}
									<small>{a.subjectName} · {when(a.when)} · {a.correctFirst}/{a.total} first try</small>
								</span>
								<span className="fm-pd__star" aria-label={`${a.stars} stars`}>{"★".repeat(a.stars) || "–"}</span>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
};

const ParentDashboard = () => {
	const [data, setData] = useState(null);
	const [error, setError] = useState(null);
	const [selected, setSelected] = useState(null);
	const load = useCallback(async () => {
		try {
			const d = await parent.overview();
			setData(d);
			setError(null);
			setSelected((cur) => (cur && d.children.some((c) => c.id === cur) ? cur : d.children[0] && d.children[0].id));
		} catch (e) {
			setError(e);
		}
	}, []);
	useEffect(() => {
		load();
		const t = setInterval(() => !document.hidden && load(), 30000);
		return () => clearInterval(t);
	}, [load]);

	const manage = (
		<span className="fm-row">
			<Link href="/family/setup/?link=1">
				<a className="fm-btn fm-btn--primary fm-btn--sm">
					<Icon name="plus" size={18} /> Link my child
				</a>
			</Link>{" "}
			<Link href="/family/manage/">
				<a className="fm-btn fm-btn--secondary fm-btn--sm">
					<Icon name="users" size={18} /> Family &amp; devices
				</a>
			</Link>
		</span>
	);

	if (error && !data) {
		return (
			<div className="fm-card" role="alert">
				<p className="fm-error"><Icon name="alert" size={18} /> {error.message}</p>
				<button type="button" className="fm-btn fm-btn--secondary" onClick={load}>Try again</button>
			</div>
		);
	}
	if (!data) return <p className="fm-muted" role="status">Loading your family…</p>;
	const child = data.children.find((c) => c.id === selected);
	return (
		<>
			<header className="fm-pagehead fm-pd__bar">
				<h1 className="fm-h1">Progress</h1>
				{manage}
			</header>
			{data.children.length === 0 ? (
				<div className="fm-card fm-empty">
					<h2 className="fm-h3">No children linked yet</h2>
					<p className="fm-muted">Your child&apos;s learner profile is set up by their instructor. Choose Link my child, then ask your child to sign in to their own SharpStudy account and show you a link code.</p>
					<Link href="/family/setup/?link=1"><a className="fm-btn fm-btn--primary">Link my child</a></Link>
				</div>
			) : (
				<div className="fm-pd">
					{data.children.length > 1 && (
						<div className="fm-pd__tabs" role="tablist" aria-label="Choose a child">
							{data.children.map((c) => (
								<button key={c.id} type="button" role="tab" aria-selected={c.id === selected} className={`fm-chip ${c.id === selected ? "is-on" : ""}`} onClick={() => setSelected(c.id)}>
									<Avatar avatar={c.avatar} size={36} /> {c.nickname}
								</button>
							))}
						</div>
					)}
					{child && <Child key={child.id} c={child} />}
				</div>
			)}
		</>
	);
};

export default ParentDashboard;
