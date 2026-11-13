import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import StudentLayout from "@/components/Learning/StudentLayout";
import GeneralLoader from "@/utils/GeneralLoader";
import { Button, EmptyState, ProgressBar, Badge } from "@/components/ui";
import BookCover from "@/components/Books/BookCover";
import ContinueReading from "@/components/Books/ContinueReading";
import { readerPath } from "@/components/Books/BuyBox";
import { money, shortDate } from "@/components/Books/format";

const STATES = [
	{ id: "all", label: "All" },
	{ id: "reading", label: "In progress" },
	{ id: "not_started", label: "Not started" },
	{ id: "finished", label: "Finished" },
];
const TONE = { paid: "success", pending: "warning", failed: "danger", refunded: "neutral" };

// Everything here is fetched with the signed-in account's token; the server returns only that
// account's purchases, so there is no id in this page that could be changed to see someone else's.
function MyBooks({ user }) {
	const [items, setItems] = useState(null);
	const [orders, setOrders] = useState([]);
	const [error, setError] = useState("");
	const [loadedFor, setLoadedFor] = useState(null); // the "search|filter" the current list was loaded for
	const [q, setQ] = useState("");
	const [status, setStatus] = useState("all");

	const load = useCallback(async () => {
		setError("");
		const key = `${q}|${status}`;
		try {
			const [mine, history] = await Promise.all([axios.get("/api/books/mine", { params: { q: q || undefined, status } }), axios.get("/api/books/orders")]);
			setItems(mine.data.items);
			setOrders(history.data.orders);
		} catch (e) {
			setError((e.response && e.response.data && e.response.data.message) || "We could not load your books. Please try again.");
			setItems([]);
		} finally {
			setLoadedFor(key);
		}
	}, [q, status]);

	useEffect(() => {
		const t = setTimeout(load, q ? 250 : 0);
		return () => clearTimeout(t);
	}, [load, q]);

	const filtering = q || status !== "all";
	return (
		<StudentLayout user={user} section="learning" title="My books" description="Books you have bought, with your reading progress.">
			{!q && status === "all" && items && <ContinueReading items={items} />}
			<h2 className="ss-sectiontitle">Purchased books</h2>
			<div className="ss-card ss-filters ss-filters--compact" role="search">
				<div className="ss-filter ss-filter--wide">
					<label htmlFor="mb-q">Search my books</label>
					<input id="mb-q" type="search" value={q} maxLength={80} onChange={(e) => setQ(e.target.value)} placeholder="Title or author" />
				</div>
				<div className="ss-filter">
					<label htmlFor="mb-s">Show</label>
					<select id="mb-s" value={status} onChange={(e) => setStatus(e.target.value)}>
						{STATES.map((s) => (
							<option key={s.id} value={s.id}>
								{s.label}
							</option>
						))}
					</select>
				</div>
			</div>

			{error && (
				<p className="ss-notice ss-notice--error" role="alert">
					{error} <button type="button" className="ss-linkbtn" onClick={load}>Retry</button>
				</p>
			)}

			{items === null || (items.length === 0 && loadedFor !== `${q}|${status}`) ? (
				<GeneralLoader />
			) : items.length === 0 && !error ? (
				<EmptyState
					icon="ri-book-2-line"
					title={filtering ? "No books match" : "You have no books yet"}
					description={filtering ? "Try another search or filter." : "Books you buy appear here and are ready to read straight away."}
					action={filtering ? <Button variant="secondary" onClick={() => { setQ(""); setStatus("all"); }}>Clear filters</Button> : <Button href="/books/">Browse Books</Button>}
				/>
			) : (
				<ul className="ss-mybooks">
					{items.map((it) => (
						<li key={it.orderId} className="ss-card ss-mybook">
							<Link href={`/books/${it.book.slug}/`}>
								<a tabIndex={-1} aria-hidden="true">
									<BookCover book={it.book} size="sm" />
								</a>
							</Link>
							<div className="ss-mybook__body">
								<h3>
									<Link href={`/books/${it.book.slug}/`}>
										<a>{it.book.title}</a>
									</Link>
								</h3>
								<p className="ss-muted">by {it.book.author}</p>
								<p className="ss-muted">
									Purchased {shortDate(it.purchasedAt)} · <Badge tone={it.access === "active" ? "success" : "warning"}>{it.access === "active" ? "Access active" : "Unavailable"}</Badge>
								</p>
								{it.progress ? (
									<>
										<ProgressBar value={it.progress.percent} label={`Reading progress for ${it.book.title}`} />
										<p className="ss-muted">
											Page {it.progress.position} of {it.progress.total} ({it.progress.percent}%)
										</p>
									</>
								) : (
									<p className="ss-muted">Not started yet</p>
								)}
							</div>
							<div className="ss-mybook__actions">
								{it.canRead && it.access === "active" ? (
									<>
										<Button href={readerPath(it.book.slug)}>{it.progress && it.progress.percent < 100 ? "Continue Reading" : "Open Book"}</Button>
										{it.progress && <Button href={readerPath(it.book.slug, true)} variant="secondary">Open Book</Button>}
									</>
								) : (
									<span className="ss-muted">This book cannot be opened right now.</span>
								)}
							</div>
						</li>
					))}
				</ul>
			)}

			<section aria-labelledby="bk-history" className="ss-bookhistory">
				<h2 id="bk-history">Purchase history</h2>
				{orders.length === 0 ? (
					<p className="ss-muted">No book purchases yet.</p>
				) : (
					<div className="ss-table-wrap">
						<table className="ss-table">
							<caption className="visually-hidden">Your book purchases and their payment status</caption>
							<thead>
								<tr>
									<th scope="col">Date</th>
									<th scope="col">Book</th>
									<th scope="col">Amount</th>
									<th scope="col">Status</th>
								</tr>
							</thead>
							<tbody>
								{orders.map((o) => (
									<tr key={o.id}>
										<td>{shortDate(o.createdAt)}</td>
										<td>{o.book ? o.book.title : "Removed book"}</td>
										<td>{money(o.amountCents, o.currency)}</td>
										<td>
											<Badge tone={TONE[o.status]}>{o.status}</Badge>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</StudentLayout>
	);
}

export default MyBooks;
