// Child-mode screens (cream, playful). No site chrome and no account: a paired device only holds its own
// secret and, after the picture tap, the child's learner session.
import React from "react";
import Head from "next/head";
import Link from "next/link";
import { Avatar, AppMark, Glyph, Icon, Picture, PICTURE_ORDER, PICTURE_STYLE } from "./art";

export const ChildFrame = ({ title, children, tone = "cream", decor = false, brand = false }) => (
	<div className={`fm-root fm-root--child fm-tone--${tone}`}>
		<Head>
			<title>{title ? `${title} · Sharp Study` : "Sharp Study"}</title>
			<meta name="robots" content="noindex" />
		</Head>
		{decor && (
			<>
				<span className="fm-decor fm-decor--sun" aria-hidden="true" />
				<span className="fm-decor fm-decor--sky" aria-hidden="true" />
				<span className="fm-decor fm-decor--leaf" aria-hidden="true" />
			</>
		)}
		{brand && (
			<header className="fm-child__brand">
				<AppMark size={40} />
				<span>Sharp Study</span>
			</header>
		)}
		<main className="fm-child__main" id="main">{children}</main>
	</div>
);

// ---------------------------------------------------------------- join
export const GONE_TEXT = {
	device_revoked: "This device was removed by your grown-up. Ask them for a new code to join again.",
	device_denied: "Your grown-up said no. Ask them for a new code.",
	device_expired: "That took too long. Ask your grown-up for a new code.",
	device_invalid: "This device is not paired any more. Ask your grown-up for a new code.",
};

// ---------------------------------------------------------------- waiting for approval
export const WaitingScreen = ({ learners, onStartOver, error }) => {
	const first = learners[0];
	return (
		<div className="fm-center-screen">
			<div className="fm-handshake" aria-hidden="true">
				<span className="fm-handshake__phone">
					<span className="fm-handshake__face">{first && <Avatar avatar={first.avatar} size={54} />}</span>
				</span>
				<span className="fm-handshake__dots"><i /><i /><i /></span>
				<span className="fm-handshake__phone fm-handshake__phone--blue">
					<Icon name="check" size={44} strokeWidth={3} />
				</span>
			</div>
			<h1 className="fm-display fm-display--lg">Ask your grown-up to say yes!</h1>
			<p className="fm-child__sub">We sent a message to their phone.</p>
			{first && (
				<p className="fm-pill" role="status">
					<Avatar avatar={first.avatar} size={44} />
					<strong>Joining as {learners.map((l) => l.nickname).join(" & ")}</strong>
				</p>
			)}
			<p className="fm-child__wait" role="status" aria-live="polite">Waiting…</p>
			{error && <p className="fm-error fm-error--child" role="alert">{error}</p>}
			<button type="button" className="fm-linkbtn fm-linkbtn--lg" onClick={onStartOver}>Start over</button>
		</div>
	);
};

// ---------------------------------------------------------------- success
export const SuccessScreen = ({ learners, onGo }) => {
	const first = learners[0];
	return (
		<div className="fm-success">
			<span className="fm-confetti fm-confetti--a" aria-hidden="true" />
			<span className="fm-confetti fm-confetti--b" aria-hidden="true" />
			<span className="fm-confetti fm-confetti--c" aria-hidden="true" />
			<span className="fm-confetti fm-confetti--d" aria-hidden="true" />
			<span className="fm-confetti fm-confetti--e" aria-hidden="true" />
			{first && <span className="fm-success__avatar"><Avatar avatar={first.avatar} size={170} /></span>}
			<h1 className="fm-display fm-display--xl fm-display--light">You&apos;re in, {learners.map((l) => l.nickname).join(" & ")}!</h1>
			<p className="fm-success__sub">This is your Sharp Study now.</p>
			<button type="button" className="fm-bigbtn fm-bigbtn--yellow" onClick={onGo} autoFocus>Let&apos;s go!</button>
			<p className="fm-success__tip">
				<Icon name="plus" size={22} />
				<span><strong>Grown-ups:</strong> tap Share › Add to Home Screen so {first ? first.nickname : "your child"} can open it like an app.</span>
			</p>
		</div>
	);
};

// ---------------------------------------------------------------- who's learning
export const Picker = ({ learners, onPick, busyId, error }) => (
	<div className="fm-picker">
		<Link href="/learn/pin/">
			<a className="fm-pill fm-pill--top"><Icon name="lock" size={18} /> Grown-ups</a>
		</Link>
		<h1 className="fm-display fm-display--lg fm-picker__title">Who&apos;s learning today?</h1>
		{error && <p className="fm-error fm-error--child" role="alert">{error}</p>}
		{learners.length === 0 ? (
			<p className="fm-child__sub">No one is set up on this device yet. Ask your grown-up.</p>
		) : (
			<ul className="fm-picker__grid">
				{learners.map((l) => (
					<li key={l.id}>
						<button type="button" className="fm-tile" onClick={() => onPick(l)} disabled={!!busyId} aria-label={`${l.nickname}`}>
							<Avatar avatar={l.avatar} size={130} />
							<span className="fm-display fm-tile__name">{l.nickname}</span>
						</button>
					</li>
				))}
			</ul>
		)}
		<p className="fm-picker__hint">Tap your picture to start.</p>
	</div>
);

// ---------------------------------------------------------------- picture code
export const PictureLogin = ({ learner, picks, setPicks, onNotMe, error, busy, lockedText }) => {
	const press = (id) => !busy && picks.length < 3 && setPicks([...picks, id]);
	return (
		<div className="fm-picture">
			<div className="fm-picture__bar">
				<button type="button" className="fm-pill" onClick={onNotMe}><Icon name="back" size={18} /> Not me</button>
				<span className="fm-picture__who"><strong>{learner.nickname}</strong><Avatar avatar={learner.avatar} size={46} /></span>
			</div>
			<h1 className="fm-display fm-display--lg">Tap your 3 secret pictures</h1>
			<div className="fm-picture__slots" role="status" aria-live="polite" aria-label={`${picks.length} of 3 pictures tapped`}>
				{[0, 1, 2].map((i) => (
					<span key={i} className={`fm-picture__slot ${picks[i] ? "is-full" : ""}`}>
						{picks[i] && <Glyph name={picks[i]} size={46} />}
					</span>
				))}
			</div>
			{(error || lockedText) && <p className="fm-error fm-error--child" role="alert">{lockedText || error}</p>}
			<div className="fm-picture__grid">
				{PICTURE_ORDER.map((id) => (
					<button key={id} type="button" className="fm-key" aria-label={PICTURE_STYLE[id].name} onClick={() => press(id)} disabled={busy || !!lockedText}>
						<Picture id={id} size={52} />
					</button>
				))}
			</div>
			<p className="fm-picture__hint">Forgot? Ask your grown-up — they can reset it in Family.</p>
		</div>
	);
};

// ---------------------------------------------------------------- home + journey
const nodeColors = ["#ffc83d", "#7ed6b0", "#fdb6a1", "#8ec5fe", "#cbb7fe"];

const Journey = ({ subjects }) => {
	const n = subjects.length + 1; // + "What's next?"
	const H = 130;
	const xs = (i) => (i % 2 === 0 ? 16 : 78);
	const pts = Array.from({ length: n }, (_, i) => ({ x: xs(i), y: 48 + i * H }));
	let d = `M ${pts[0].x} ${pts[0].y}`;
	for (let i = 1; i < pts.length; i++) {
		const a = pts[i - 1];
		const b = pts[i];
		d += ` C ${a.x} ${a.y + H * 0.55}, ${b.x} ${b.y - H * 0.55}, ${b.x} ${b.y}`;
	}
	return (
		<div className="fm-journey" style={{ height: n * H }}>
			<svg className="fm-journey__path" viewBox={`0 0 100 ${n * H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
				<path d={d} fill="none" stroke="#e8d9ae" strokeWidth="9" strokeLinecap="round" strokeDasharray="0.1 16" vectorEffect="non-scaling-stroke" />
			</svg>
			{subjects.map((s, i) => {
				const p = pts[i];
				const left = p.x < 50;
				const href = `/learn/worksheet/?subject=${s.id}&level=${encodeURIComponent(s.position.levelId)}&set=${encodeURIComponent(s.position.setId)}&ws=${s.position.worksheetNo}`;
				const fresh = s.progress != null && s.progress === 0;
				return (
					<Link href={href} key={s.id}>
						<a className={`fm-node ${left ? "fm-node--left" : "fm-node--right"}`} style={{ top: p.y - 34, [left ? "left" : "right"]: left ? "3%" : "3%" }}>
							<span className="fm-node__dot" style={{ background: nodeColors[i % nodeColors.length] }}>
								<i className={s.icon} aria-hidden="true" />
							</span>
							<span className="fm-node__text">
								<strong>{s.name}</strong>
								<small>{s.position.setTitle}</small>
								<em className={fresh ? "is-new" : ""}>{fresh ? "New!" : "Keep going"}</em>
							</span>
						</a>
					</Link>
				);
			})}
			<span className="fm-node fm-node--right fm-node--next" style={{ top: pts[n - 1].y - 34, [pts[n - 1].x < 50 ? "left" : "right"]: "3%" }}>
				<span className="fm-node__dot fm-node__dot--ghost"><Icon name="question" size={28} /></span>
				<span className="fm-node__text"><strong>What&apos;s next?</strong></span>
			</span>
		</div>
	);
};

export const ChildHome = ({ learner, home, error, onRetry, connected }) => {
	const open = home ? home.assignments.filter((a) => a.status === "pending" || a.status === "in_progress" || a.status === "overdue") : [];
	const next = open[0];
	return (
		<div className="fm-home">
			<header className="fm-home__head">
				<Avatar avatar={learner.avatar} size={56} />
				<h1 className="fm-display">Hi {learner.displayName}!</h1>
				<Link href="/learn/pin/"><a className="fm-roundbtn" aria-label="Grown-ups only"><Icon name="lock" size={24} /></a></Link>
			</header>

			<section className="fm-hero" aria-label="Today">
				<span className="fm-hero__orb" aria-hidden="true"><Glyph name="star" size={52} /></span>
				{next ? (
					<>
						<h2 className="fm-display fm-display--light">Your grown-up picked something for you!</h2>
						<p className="fm-hero__sub">{next.title}</p>
						<Link href={`/learn/worksheet/?subject=${next.subject}&level=${encodeURIComponent(next.levelId)}&set=${encodeURIComponent(next.setId)}&ws=${next.worksheetNo}&assignment=${next.id}`}>
							<a className="fm-bigbtn fm-bigbtn--yellow fm-bigbtn--inline">{next.status === "in_progress" ? "Keep going" : "Start"}</a>
						</Link>
					</>
				) : (
					<h2 className="fm-display fm-display--light">Waiting for your grown-up to start</h2>
				)}
				<p className="fm-hero__status"><span className={`fm-dot ${connected ? "" : "is-off"}`} aria-hidden="true" /> {connected ? "Connected" : "Reconnecting…"}</p>
			</section>

			<h2 className="fm-display fm-home__title">My learning journey</h2>
			<section className="fm-card fm-card--child" aria-label="My learning journey">
				{error ? (
					<div role="alert">
						<p className="fm-error fm-error--child">{error}</p>
						<button type="button" className="fm-btn fm-btn--secondary" onClick={onRetry}>Try again</button>
					</div>
				) : !home ? (
					<p className="fm-muted" role="status">Getting your journey ready…</p>
				) : home.subjects.length === 0 ? (
					<p className="fm-muted">Your grown-up hasn&apos;t picked any subjects for you yet.</p>
				) : (
					<Journey subjects={home.subjects} />
				)}
			</section>
		</div>
	);
};
