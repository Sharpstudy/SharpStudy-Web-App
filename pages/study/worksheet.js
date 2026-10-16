// Worksheet player: one question at a time, immediate checking, required
// correction after a wrong answer, running timer against the target time.
//
// The sheet comes from the server only if it is unlocked. Progress is kept
// in local storage so a refresh or lost connection never loses work, and
// finished attempts go through the offline queue (idempotent clientAttemptId).
// Leaving or abandoning never records a completion.
import React, { useCallback, useEffect, useRef, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import MasteryShell from "@/components/Mastery/MasteryShell";
import QuestionView from "@/components/Mastery/QuestionView";
import AnswerInput from "@/components/Mastery/AnswerInput";
import TutorPanel from "@/components/Mastery/TutorPanel";
import { checkAnswer } from "@/lib/mastery/answers";
import { scoreAttempt, nextActionLabel, STATUS } from "@/lib/mastery/rules";
import { newClientAttemptId } from "@/lib/mastery/offline";
import { api, getActiveLearner, getLearnerToken } from "@/lib/mastery-client/api";
import { offline, submitQueued } from "@/lib/mastery-client/sync";

const fmtTime = (ms) => {
	const s = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const emptyValue = (p) => (p.type === "multi" ? p.inputs.map(() => "") : "");
const isEmpty = (v) => (Array.isArray(v) ? v.every((x) => !String(x).trim()) : !String(v || "").trim());

const Stars = ({ n }) => (
	<p className="ml-stars" aria-label={`${n} of 3 stars`}>
		{[1, 2, 3].map((i) => (
			<i key={i} className={i <= n ? "ri-star-fill is-on" : "ri-star-line"} aria-hidden="true"></i>
		))}
	</p>
);

const Results = ({ result, pending, coords, onAgain }) => {
	const acc = Math.round((result.correctFirst / result.total) * 100);
	const overTarget = result.durationMs / 1000 > result.targetSeconds;
	const next = result.next;
	return (
		<section className="ml-card ml-results" aria-labelledby="results-title">
			<h1 id="results-title" className="ml-h1">
				{result.status === STATUS.REPEAT ? "Good effort!" : result.stars === 3 ? "Brilliant!" : "Well done!"}
			</h1>
			<Stars n={result.stars} />
			<dl className="ml-results__grid">
				<div>
					<dt>First-try accuracy</dt>
					<dd>
						{result.correctFirst}/{result.total} ({acc}%)
					</dd>
				</div>
				<div>
					<dt>Time</dt>
					<dd>
						{fmtTime(result.durationMs)} <span className="ml-muted">/ target {fmtTime(result.targetSeconds * 1000)}</span>
					</dd>
				</div>
				<div>
					<dt>Result</dt>
					<dd>{result.status === STATUS.MASTERED ? "Mastered" : result.status === STATUS.PRACTICE_SPEED ? "Practise for speed" : "Repeat"}</dd>
				</div>
			</dl>
			{pending ? (
				<p className="ml-note ml-note--warning" role="status">
					Saved on this device. It will be checked and recorded when you are back online — your next worksheet unlocks after that.
				</p>
			) : (
				<p className="ml-note ml-note--info" role="status">
					{result.nextAction}
					{overTarget && result.status !== STATUS.REPEAT ? " Try to beat the target time next go!" : ""}
				</p>
			)}
			<div className="ml-row ml-row--center">
				{!pending && next && (
					<Link href={`/study/worksheet/?subject=${coords.subject}&level=${next.levelId}&set=${next.setId}&ws=${next.worksheetNo}`}>
						<a className="ss-btn">
							{next.worksheetNo === coords.worksheetNo && next.setId === coords.setId ? "Try again" : "Next worksheet"}
						</a>
					</Link>
				)}
				{!pending && !next && result.outcome === "review" && (
					<button type="button" className="ss-btn ss-btn--secondary" onClick={onAgain}>
						Practise again
					</button>
				)}
				<Link href="/study/">
					<a className="ss-btn ss-btn--ghost">Back to my ladder</a>
				</Link>
			</div>
		</section>
	);
};

const WorksheetPage = ({ user }) => {
	const router = useRouter();
	const q = router.query;
	// ?assignment=<id>: started from a worksheet an instructor assigned (the server uses the stored assignment, not these values).
	const coords = q.subject ? { subject: q.subject, levelId: q.level, setId: q.set, worksheetNo: Number(q.ws), ...(q.assignment ? { assignmentId: String(q.assignment) } : {}) } : null;

	const [learner, setLearner] = useState(null);
	const [state, setState] = useState(null); // in-progress state (persisted)
	const [value, setValue] = useState("");
	const [feedback, setFeedback] = useState(null); // "right" | "wrong"
	const [error, setError] = useState(null);
	const [result, setResult] = useState(null);
	const [pendingSync, setPendingSync] = useState(false);
	const [leaving, setLeaving] = useState(false);
	const [now, setNow] = useState(Date.now());
	const resumedAt = useRef(Date.now());

	const persist = useCallback(
		(s) => {
			if (learner && s) offline.saveInProgress(learner.id, s);
		},
		[learner]
	);

	// Elapsed time = time banked before this page load + time since resume.
	const elapsed = state ? state.elapsedMs + (now - resumedAt.current) : 0;

	// Load: resume local progress for these coordinates, otherwise ask the
	// server (which refuses locked worksheets).
	useEffect(() => {
		if (!router.isReady || !coords) return;
		// Same page component is reused for "Next worksheet": reset everything.
		setResult(null);
		setError(null);
		setState(null);
		setFeedback(null);
		setPendingSync(false);
		if (!getLearnerToken()) {
			router.replace("/study/");
			return;
		}
		const active = getActiveLearner();
		setLearner(active);
		const saved = active && offline.loadInProgress(active.id);
		const same =
			saved &&
			saved.sheetMeta &&
			saved.sheetMeta.subject === coords.subject &&
			saved.sheetMeta.levelId === coords.levelId &&
			saved.sheetMeta.setId === coords.setId &&
			saved.sheetMeta.worksheetNo === coords.worksheetNo &&
			(saved.sheetMeta.assignmentId || null) === (coords.assignmentId || null);
		if (same) {
			resumedAt.current = Date.now();
			setState(saved);
			setValue(emptyValue(saved.sheet.problems[saved.index]));
			return;
		}
		api
			.post("/study/start", coords)
			.then((r) => {
				const s = {
					sheet: r.sheet,
					startToken: r.startToken,
					sessionId: r.sessionId,
					isCurrent: r.isCurrent,
					clientAttemptId: newClientAttemptId(),
					index: 0,
					responses: r.sheet.problems.map(() => []),
					elapsedMs: 0,
					answered: 0,
					total: r.sheet.problems.length,
					sheetMeta: { ...coords, setTitle: r.sheet.setTitle, levelTitle: r.sheet.levelTitle },
				};
				resumedAt.current = Date.now();
				setState(s);
				setValue(emptyValue(r.sheet.problems[0]));
				if (active) offline.saveInProgress(active.id, s);
			})
			.catch((e) => {
				if (e.status === 401) router.replace("/study/");
				else setError(e);
			});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [router.isReady, q.subject, q.level, q.set, q.ws]);

	// Ticking clock; pause banking when the tab is hidden.
	useEffect(() => {
		if (!state || result) return;
		const t = setInterval(() => setNow(Date.now()), 1000);
		const onVis = () => {
			if (document.hidden) {
				setState((s) => {
					if (!s) return s;
					const next = { ...s, elapsedMs: s.elapsedMs + (Date.now() - resumedAt.current) };
					resumedAt.current = Date.now();
					persist(next);
					return next;
				});
			} else {
				resumedAt.current = Date.now();
			}
		};
		document.addEventListener("visibilitychange", onVis);
		return () => {
			clearInterval(t);
			document.removeEventListener("visibilitychange", onVis);
		};
	}, [state, result, persist]);

	const finish = async (s) => {
		const durationMs = s.elapsedMs;
		const item = {
			learnerId: learner && learner.id,
			startToken: s.startToken,
			clientAttemptId: s.clientAttemptId,
			responses: s.responses,
			durationMs,
			completedAt: new Date().toISOString(),
		};
		offline.enqueue(item);
		offline.clearInProgress(learner.id);
		// Provisional score (same pure rules as the server) for offline display.
		const correctFirst = s.sheet.problems.filter((p, i) => checkAnswer(p.answer, s.responses[i][0])).length;
		const local = scoreAttempt({ correctFirst, total: s.total, durationSec: durationMs / 1000, targetSec: s.sheet.targetSeconds });
		const provisional = {
			correctFirst,
			total: s.total,
			durationMs,
			targetSeconds: s.sheet.targetSeconds,
			stars: local.stars,
			status: local.status,
			nextAction: nextActionLabel("review"),
		};
		try {
			const r = await submitQueued(item);
			offline.remove(item.clientAttemptId);
			setResult(r);
			setPendingSync(false);
		} catch (e) {
			if (e.status && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429) {
				offline.remove(item.clientAttemptId);
				setError(e);
			} else {
				setResult(provisional);
				setPendingSync(true);
			}
		}
	};

	const check = (override) => {
		if (!state || feedback === "right") return;
		const problem = state.sheet.problems[state.index];
		const input = override !== undefined ? override : value;
		if (isEmpty(input)) return;
		const ok = checkAnswer(problem.answer, input);
		const responses = state.responses.map((r, i) => (i === state.index ? [...r, input] : r));
		const banked = state.elapsedMs + (Date.now() - resumedAt.current);
		resumedAt.current = Date.now();
		if (!ok) {
			const next = { ...state, responses, elapsedMs: banked };
			setState(next);
			persist(next);
			setFeedback("wrong");
			return;
		}
		setFeedback("right");
		const last = state.index === state.total - 1;
		const next = { ...state, responses, elapsedMs: banked, answered: state.index + 1, index: last ? state.index : state.index + 1 };
		setState(next);
		if (last) {
			finish(next);
			return;
		}
		persist(next);
		setTimeout(() => {
			setFeedback(null);
			setValue(emptyValue(next.sheet.problems[next.index]));
		}, 600);
	};

	const abandon = () => {
		if (learner) offline.clearInProgress(learner.id);
		router.push("/study/");
	};
	const saveAndLeave = () => {
		if (state) persist({ ...state, elapsedMs: state.elapsedMs + (Date.now() - resumedAt.current) });
		router.push("/study/");
	};

	let body;
	if (error) {
		body = (
			<div className="ml-card">
				<h1 className="ml-h2">{error.code === "locked" ? "This worksheet is locked" : "We could not open this worksheet"}</h1>
				<p>{error.message}</p>
				<Link href="/study/">
					<a className="ss-btn">Back to my ladder</a>
				</Link>
			</div>
		);
	} else if (result) {
		body = <Results result={result} pending={pendingSync} coords={coords} onAgain={() => router.reload()} />;
	} else if (!state) {
		body = <p className="ml-loading" role="status">Getting your worksheet ready…</p>;
	} else {
		const problem = state.sheet.problems[state.index];
		const tries = state.responses[state.index].length;
		const target = state.sheet.targetSeconds * 1000;
		const pct = Math.min(100, (elapsed / target) * 100);
		body = (
			<div className="ml-player">
				<header className="ml-player__bar">
					<div>
						<p className="ml-muted ml-small">
							{state.sheet.levelId} · {state.sheet.setTitle} · Worksheet {state.sheet.worksheetNo}
							{!state.isCurrent && " (review)"}
						</p>
						<ol className="ml-dots" aria-label={`Question ${state.index + 1} of ${state.total}`}>
							{state.sheet.problems.map((_, i) => (
								<li key={i} className={i < state.answered ? "is-done" : i === state.index ? "is-current" : ""} />
							))}
						</ol>
					</div>
					<div className={`ml-timer${elapsed > target ? " is-over" : ""}`} role="timer" aria-live="off">
						<span className="ml-timer__value">{fmtTime(elapsed)}</span>
						<span className="ml-timer__target">target {fmtTime(target)}</span>
						<span className="ml-timer__bar" aria-hidden="true">
							<span style={{ width: `${pct}%` }} />
						</span>
					</div>
					<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={() => setLeaving(true)}>
						Leave
					</button>
				</header>

				<div className="ml-card ml-player__card">
					<QuestionView problem={problem} number={state.index + 1} total={state.total} />
					<AnswerInput
						problem={problem}
						value={value}
						onChange={(v) => {
							setValue(v);
							if (feedback === "wrong") setFeedback(null);
						}}
						onSubmit={check}
						disabled={feedback === "right"}
						status={feedback}
					/>
					<p className={`ml-feedback-line${feedback ? ` is-${feedback}` : ""}`} role="status" aria-live="assertive">
						{feedback === "right" && "Correct!"}
						{feedback === "wrong" && "Not quite — have another go. You need to fix it before moving on."}
					</p>
				</div>

				<TutorPanel startToken={state.startToken} questionIndex={state.index} attempted={tries ? state.responses[state.index][tries - 1] : null} tries={tries} lesson={state.sheet.lesson} />

				{leaving && (
					<div className="ml-modal" role="dialog" aria-modal="true" aria-labelledby="leave-title">
						<div className="ml-card ml-modal__body">
							<h2 id="leave-title" className="ml-h3">
								Leave this worksheet?
							</h2>
							<p>It will not count as finished. You can save it on this device and carry on later, or throw it away.</p>
							<div className="ml-row ml-row--end">
								<button type="button" className="ss-btn ss-btn--ghost" onClick={() => setLeaving(false)}>
									Keep going
								</button>
								<button type="button" className="ss-btn ss-btn--secondary" onClick={saveAndLeave}>
									Save &amp; leave
								</button>
								<button type="button" className="ss-btn ss-btn--danger" onClick={abandon}>
									Abandon
								</button>
							</div>
						</div>
					</div>
				)}
			</div>
		);
	}

	return (
		<MasteryShell user={user} className="ml-shell--focus">
			<Head>
				<title>Worksheet — SharpStudy</title>
			</Head>
			<div className="ss-container ml-page">{body}</div>
		</MasteryShell>
	);
};

export default WorksheetPage;
