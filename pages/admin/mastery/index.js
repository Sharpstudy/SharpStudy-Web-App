// Mastery Ladder administration. Tabs are shown according to the caller's
// permissions (from /api/mastery/me), but every action is authorised again
// by the API — hiding a tab is a convenience, not the protection.
import React, { useCallback, useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import AccessDenied from "@/components/Mastery/AccessDenied";
import { StatTile } from "@/components/ui";
import { api } from "@/lib/mastery-client/api";

const TABS = [
	{ id: "overview", label: "Overview", icon: "ri-pulse-line", perm: "admin.access" },
	{ id: "learners", label: "Learners", icon: "ri-group-line", perm: "learners.manage_all" },
	{ id: "users", label: "Users & roles", icon: "ri-user-settings-line", perm: "users.manage" },
	{ id: "roles", label: "Access rights", icon: "ri-shield-user-line", perm: "roles.manage" },
	{ id: "audit", label: "Audit log", icon: "ri-file-list-3-line", perm: "audit.view" },
	{ id: "feedback", label: "Feedback", icon: "ri-feedback-line", perm: "feedback.manage" },
	{ id: "tutor", label: "Sage tutor", icon: "ri-robot-2-line", perm: "tutor.configure" },
	{ id: "reset", label: "Global reset", icon: "ri-error-warning-line", perm: "system.global_reset" },
];

const opts = { learner: false };
const fmt = (d) => (d ? new Date(d).toLocaleString() : "–");

const useLoad = (fn, deps) => {
	const [state, setState] = useState({ data: null, error: null });
	const load = useCallback(() => {
		fn()
			.then((data) => setState({ data, error: null }))
			.catch((error) => setState({ data: null, error }));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, deps);
	useEffect(load, [load]);
	return [state, load];
};

const Status = ({ error }) => (error ? (error.status === 403 || error.status === 401 ? <AccessDenied message={error.message} /> : <p className="ml-note ml-note--danger">{error.message}</p>) : <p className="ml-loading">Loading…</p>);

const Pager = ({ page, pages, onPage }) =>
	pages > 1 ? (
		<div className="ml-row">
			<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
				Previous
			</button>
			<span className="ml-small">
				Page {page} of {pages}
			</span>
			<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
				Next
			</button>
		</div>
	) : null;

const Overview = () => {
	const [{ data, error }] = useLoad(() => api.get("/admin/presence", opts), []);
	if (!data) return <Status error={error} />;
	return (
		<>
			<div className="ml-stats">
				<StatTile icon="ri-user-line" value={data.users} label={`Adults active (last ${data.windowMinutes} min)`} />
				<StatTile icon="ri-user-smile-line" tone="accent" value={data.learners} label={`Learners active (last ${data.windowMinutes} min)`} />
			</div>
			<div className="ss-table-wrap">
				<table className="ml-table">
					<thead><tr><th>Type</th><th>Page</th><th>Last seen</th></tr></thead>
					<tbody>
						{data.recent.map((r) => (
							<tr key={`${r.kind}-${r.id}`}><td>{r.kind}</td><td>{r.path}</td><td>{fmt(r.lastSeenAt)}</td></tr>
						))}
					</tbody>
				</table>
			</div>
		</>
	);
};

const Learners = () => {
	const [q, setQ] = useState("");
	const [{ data, error }, reload] = useLoad(() => api.get(`/admin/learners?q=${encodeURIComponent(q)}`, opts), [q]);
	return (
		<>
			<form className="ml-row" onSubmit={(e) => { e.preventDefault(); reload(); }}>
				<input className="ml-text" placeholder="Search learner name" aria-label="Search learners" value={q} onChange={(e) => setQ(e.target.value)} />
			</form>
			{!data ? <Status error={error} /> : (
				<div className="ss-table-wrap">
					<table className="ml-table">
						<thead><tr><th>Learner</th><th>Owner</th><th>Last seen</th><th>Adult mode</th><th /></tr></thead>
						<tbody>
							{data.learners.map((l) => (
								<tr key={l.id}>
									<td>{l.avatar} {l.displayName}</td>
									<td>{l.ownerEmail}</td>
									<td>{fmt(l.lastSeenAt)}</td>
									<td>{l.adultMode ? "Yes" : "No"}</td>
									<td>
										<Link href={`/family/?learner=${l.id}`}><a className="ss-btn ss-btn--ghost ss-btn--sm">Manage</a></Link>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</>
	);
};

const Users = () => {
	const [q, setQ] = useState("");
	const [page, setPage] = useState(1);
	const [msg, setMsg] = useState(null);
	const [{ data, error }, reload] = useLoad(() => Promise.all([api.get(`/admin/users?q=${encodeURIComponent(q)}&page=${page}`, opts), api.get("/admin/roles", opts).catch(() => ({ roles: [] }))]), [q, page]);
	const patch = async (body) => {
		setMsg(null);
		try {
			await api.patch("/admin/users", body, opts);
			setMsg({ tone: "success", text: "Saved." });
			reload();
		} catch (e) {
			setMsg({ tone: "danger", text: e.message });
		}
	};
	if (!data) return <Status error={error} />;
	const [users, { roles }] = data;
	return (
		<>
			<input className="ml-text" placeholder="Search name or email" aria-label="Search users" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
			{msg && <p className={`ml-note ml-note--${msg.tone}`} role="status">{msg.text}</p>}
			<div className="ss-table-wrap">
				<table className="ml-table">
					<thead><tr><th>User</th><th>Built-in role</th><th>Custom roles</th></tr></thead>
					<tbody>
						{users.users.map((u) => (
							<tr key={u.id}>
								<td>{u.name || "–"}<br /><span className="ml-small ml-muted">{u.email}</span></td>
								<td>
									<select className="ml-text ml-text--short" aria-label={`Role for ${u.email}`} value={u.role} onChange={(e) => patch({ userId: u.id, role: e.target.value })}>
										<option value="student">student</option>
										<option value="instructor">instructor</option>
										<option value="admin">admin</option>
									</select>
								</td>
								<td>
									{roles.length === 0 ? <span className="ml-muted ml-small">No custom roles</span> : roles.map((r) => (
										<label key={r.id} className="ml-check-row ml-small">
											<input
												type="checkbox"
												checked={u.roleIds.includes(r.id)}
												onChange={(e) => patch({ userId: u.id, roleIds: e.target.checked ? [...u.roleIds, r.id] : u.roleIds.filter((x) => x !== r.id) })}
											/>
											{r.name}
										</label>
									))}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<Pager page={users.page} pages={users.pages} onPage={setPage} />
		</>
	);
};

const Roles = () => {
	const [{ data, error }, reload] = useLoad(() => api.get("/admin/roles", opts), []);
	const [draft, setDraft] = useState({ name: "", description: "", permissions: [] });
	const [msg, setMsg] = useState(null);
	const act = async (fn) => {
		setMsg(null);
		try {
			await fn();
			reload();
		} catch (e) {
			setMsg(e.message);
		}
	};
	if (!data) return <Status error={error} />;
	const toggle = (list, p) => (list.includes(p) ? list.filter((x) => x !== p) : [...list, p]);
	return (
		<>
			<p className="ml-muted">
				Built-in roles always keep their access: admin has every permission, instructors can print any worksheet. Custom roles add permissions on top.
			</p>
			{msg && <p className="ml-note ml-note--danger" role="alert">{msg}</p>}
			<div className="ss-table-wrap">
				<table className="ml-table ml-table--matrix">
					<thead>
						<tr>
							<th>Role</th>
							{data.permissions.map((p) => <th key={p.id} title={p.description}><span className="ml-small">{p.id}</span></th>)}
							<th />
						</tr>
					</thead>
					<tbody>
						{data.roles.map((r) => (
							<tr key={r.id}>
								<th scope="row">{r.name}<br /><span className="ml-small ml-muted">{r.description}</span></th>
								{data.permissions.map((p) => (
									<td key={p.id}>
										<input type="checkbox" aria-label={`${r.name}: ${p.description}`} checked={(r.permissions || []).includes(p.id)} onChange={() => act(() => api.patch("/admin/roles", { id: r.id, permissions: toggle(r.permissions || [], p.id) }, opts))} />
									</td>
								))}
								<td>
									<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={() => window.confirm(`Delete role "${r.name}"?`) && act(() => api.del("/admin/roles", { id: r.id }, opts))}>Delete</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<form className="ml-card ml-form" onSubmit={(e) => { e.preventDefault(); act(() => api.post("/admin/roles", draft, opts).then(() => setDraft({ name: "", description: "", permissions: [] }))); }}>
				<h3 className="ml-h4">New role</h3>
				<div className="ml-grid-2">
					<input className="ml-text" required placeholder="Role name" aria-label="Role name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
					<input className="ml-text" placeholder="Description" aria-label="Description" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
				</div>
				<div className="ml-checks">
					{data.permissions.map((p) => (
						<label key={p.id} className="ml-check-row ml-small">
							<input type="checkbox" checked={draft.permissions.includes(p.id)} onChange={() => setDraft({ ...draft, permissions: toggle(draft.permissions, p.id) })} />
							{p.description}
						</label>
					))}
				</div>
				<button type="submit" className="ss-btn ss-btn--sm">Create role</button>
			</form>
		</>
	);
};

const Audit = () => {
	const [action, setAction] = useState("");
	const [page, setPage] = useState(1);
	const [{ data, error }] = useLoad(() => api.get(`/admin/audit?page=${page}${action ? `&action=${encodeURIComponent(action)}` : ""}`, opts), [action, page]);
	return (
		<>
			<select className="ml-text ml-text--short" aria-label="Filter by action" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
				<option value="">All actions</option>
				{["auth.login", "auth.login_failed", "learner.login", "learner.login_failed", "placement.change", "learner.pin_reset", "learner.progress_reset", "learner.adult_mode", "learner.remove", "user.role_change", "role.update", "tutor.settings", "system.global_reset"].map((a) => <option key={a} value={a}>{a}</option>)}
			</select>
			{!data ? <Status error={error} /> : (
				<>
					<div className="ss-table-wrap">
						<table className="ml-table">
							<thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Learner</th><th>Details</th><th>IP</th></tr></thead>
							<tbody>
								{data.entries.map((e) => (
									<tr key={e.id}>
										<td>{fmt(e.created_at)}</td>
										<td><code>{e.action}</code></td>
										<td className="ml-small">{e.actor_user_id || (e.actor_learner_id && `learner ${e.actor_learner_id}`) || "–"}</td>
										<td className="ml-small">{e.learner_id || "–"}</td>
										<td className="ml-small"><code>{JSON.stringify(e.details)}</code></td>
										<td className="ml-small">{e.ip || "–"}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<Pager page={data.page} pages={data.pages} onPage={setPage} />
				</>
			)}
		</>
	);
};

const Feedback = () => {
	const [status, setStatus] = useState("");
	const [page, setPage] = useState(1);
	const [shot, setShot] = useState(null);
	const [{ data, error }, reload] = useLoad(() => api.get(`/admin/feedback?page=${page}${status ? `&status=${status}` : ""}`, opts), [status, page]);
	const update = (id, body) => api.patch("/admin/feedback", { id, ...body }, opts).then(reload);
	return (
		<>
			<select className="ml-text ml-text--short" aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
				<option value="">All</option><option value="new">New</option><option value="reviewing">Reviewing</option><option value="resolved">Resolved</option>
			</select>
			{!data ? <Status error={error} /> : (
				<>
					<ul className="ml-list">
						{data.items.map((f) => (
							<li key={f.id} className="ml-card">
								<p className="ml-small ml-muted">{fmt(f.created_at)} · {f.page || "–"} · {f.learner_id ? "from a learner" : "from an adult"}</p>
								<p style={{ whiteSpace: "pre-wrap" }}>{f.message}</p>
								<div className="ml-row ml-row--wrap">
									<select className="ml-text ml-text--short" aria-label="Status" value={f.status} onChange={(e) => update(f.id, { status: e.target.value })}>
										<option value="new">New</option><option value="reviewing">Reviewing</option><option value="resolved">Resolved</option>
									</select>
									{!!Number(f.has_screenshot) && (
										<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={() => api.get(`/admin/feedback?screenshot=${f.id}`, opts).then((r) => setShot(r.screenshot))}>View screenshot</button>
									)}
								</div>
							</li>
						))}
					</ul>
					<Pager page={data.page} pages={data.pages} onPage={setPage} />
				</>
			)}
			{shot && (
				<div className="ml-modal" role="dialog" aria-modal="true" aria-label="Screenshot">
					<div className="ml-card ml-modal__body">
						{/* eslint-disable-next-line @next/next/no-img-element */}
						<img src={shot} alt="Feedback screenshot" style={{ maxWidth: "100%" }} />
						<button type="button" className="ss-btn ss-btn--sm" onClick={() => setShot(null)}>Close</button>
					</div>
				</div>
			)}
		</>
	);
};

const Tutor = () => {
	const [{ data, error }, reload] = useLoad(() => api.get("/admin/settings", opts), []);
	const [msg, setMsg] = useState(null);
	const save = async (patch) => {
		setMsg(null);
		try {
			await api.put("/admin/settings", patch, opts);
			setMsg({ tone: "success", text: "Saved." });
			reload();
		} catch (e) {
			setMsg({ tone: "danger", text: e.message });
		}
	};
	if (!data) return <Status error={error} />;
	const s = data.settings;
	return (
		<div className="ml-stack">
			<p className={`ml-note ml-note--${data.apiKeyConfigured ? "success" : "warning"}`}>
				{data.apiKeyConfigured ? "A Claude API key is configured on the server." : "No ANTHROPIC_API_KEY is set on the server — Sage uses built-in lessons and worked examples only."}
			</p>
			<label className="ml-check-row"><input type="checkbox" checked={s.enabled} onChange={(e) => save({ enabled: e.target.checked })} /> Sage tutor enabled</label>
			<label className="ml-check-row"><input type="checkbox" checked={s.chatEnabled} onChange={(e) => save({ chatEnabled: e.target.checked })} /> Allow Socratic chat (free-text questions from learners)</label>
			<div className="ml-grid-2">
				<div className="ml-field">
					<label htmlFor="tu-model">Model</label>
					<select id="tu-model" className="ml-text" value={s.model} onChange={(e) => save({ model: e.target.value })}>
						{data.models.map((m) => <option key={m} value={m}>{m}</option>)}
					</select>
				</div>
				<div className="ml-field">
					<label htmlFor="tu-limit">Requests per learner per hour</label>
					<input id="tu-limit" type="number" min={1} max={1000} className="ml-text ml-text--short" defaultValue={s.maxRequestsPerHour} onBlur={(e) => Number(e.target.value) !== s.maxRequestsPerHour && save({ maxRequestsPerHour: Number(e.target.value) })} />
				</div>
			</div>
			{msg && <p className={`ml-note ml-note--${msg.tone}`} role="status">{msg.text}</p>}
		</div>
	);
};

const GlobalReset = () => {
	const PHRASE = "RESET ALL PROGRESS";
	const [phrase, setPhrase] = useState("");
	const [password, setPassword] = useState("");
	const [msg, setMsg] = useState(null);
	const [busy, setBusy] = useState(false);
	const go = async (e) => {
		e.preventDefault();
		if (!window.confirm("This permanently deletes every learner's attempts and habit history and resets all placements. Continue?")) return;
		setBusy(true);
		setMsg(null);
		try {
			const r = await api.post("/admin/global-reset", { phrase, password }, opts);
			setMsg({ tone: "success", text: `Reset complete: ${r.attempts} attempts and ${r.activity} activity days removed; ${r.progress} placements reset.` });
			setPhrase("");
			setPassword("");
		} catch (err) {
			setMsg({ tone: "danger", text: err.message });
		} finally {
			setBusy(false);
		}
	};
	return (
		<form className="ml-card ml-form ml-danger" onSubmit={go}>
			<p><strong>Global reset</strong> deletes all worksheet attempts, hint records and daily activity for every learner and moves every learner back to the start of each subject. Learner profiles and accounts are kept. This cannot be undone.</p>
			<div className="ml-field">
				<label htmlFor="gr-phrase">Type <code>{PHRASE}</code></label>
				<input id="gr-phrase" className="ml-text" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" />
			</div>
			<div className="ml-field">
				<label htmlFor="gr-pass">Your password</label>
				<input id="gr-pass" type="password" className="ml-text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
			</div>
			{msg && <p className={`ml-note ml-note--${msg.tone}`} role="status">{msg.text}</p>}
			<button type="submit" className="ss-btn ss-btn--danger" disabled={busy || phrase !== PHRASE || !password}>Reset all progress</button>
		</form>
	);
};

const PANELS = { overview: Overview, learners: Learners, users: Users, roles: Roles, audit: Audit, feedback: Feedback, tutor: Tutor, reset: GlobalReset };

const MasteryAdmin = ({ user }) => {
	const router = useRouter();
	const [perms, setPerms] = useState(null);
	useEffect(() => {
		api.get("/me", opts).then((d) => setPerms((d.account && d.account.permissions) || [])).catch(() => setPerms([]));
	}, []);
	const visible = perms ? TABS.filter((t) => perms.includes(t.perm)) : [];
	const tab = visible.find((t) => t.id === router.query.tab) || visible[0];
	const Panel = tab && PANELS[tab.id];

	return (
		<>
			<Head><title>Mastery Ladder admin — SharpStudy</title></Head>
			<Navbar user={user} />
			<div className="ss-dash ss-dash--admin">
				<div className="ss-container ss-container--wide ss-dash__grid">
					<aside className="ss-dash__side" aria-label="Mastery admin navigation">
						<p className="ss-dash__label">Mastery Ladder</p>
						<nav className="ss-dash__nav" aria-label="Mastery admin">
							{visible.map((t) => (
								<Link key={t.id} href={`/admin/mastery/?tab=${t.id}`}>
									<a className={tab && tab.id === t.id ? "active" : ""} aria-current={tab && tab.id === t.id ? "page" : undefined}>
										<i className={t.icon} aria-hidden="true"></i>
										{t.label}
									</a>
								</Link>
							))}
							{user && user.role === "admin" && (
								<Link href="/admin/"><a><i className="ri-arrow-left-line" aria-hidden="true"></i>Main admin</a></Link>
							)}
						</nav>
					</aside>
					<main className="ss-dash__main">
						{perms === null ? (
							<p className="ml-loading">Loading…</p>
						) : !Panel ? (
							<AccessDenied />
						) : (
							<>
								<div className="ss-dash__head"><div><h1>{tab.label}</h1></div></div>
								<Panel />
							</>
						)}
					</main>
				</div>
			</div>
			<Footer />
		</>
	);
};

export default MasteryAdmin;
