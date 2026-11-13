import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import axios from "axios";
import toast from "react-hot-toast";
import AdminLayout from "@/components/_App/AdminLayout";
import GeneralLoader from "@/utils/GeneralLoader";
import { Button, Badge, EmptyState } from "@/components/ui";
import BookCover from "@/components/Books/BookCover";
import { money, shortDate } from "@/components/Books/format";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { CATEGORIES } from "@/lib/books/taxonomy";

const TONE = { published: "success", draft: "warning", archived: "neutral", paid: "success", pending: "warning", failed: "danger", refunded: "neutral" };
const msg = (e, fallback) => (e.response && e.response.data && e.response.data.message) || fallback;

const Stat = ({ label, value }) => (
	<div className="ss-stat-mini">
		<strong>{value}</strong>
		<span>{label}</span>
	</div>
);

// Administrators only: the page is gated in _app (pageAccess) and every API call re-checks the role.
const AdminBooks = ({ user }) => {
	const router = useRouter();
	const [tab, setTab] = useState("books");
	const [data, setData] = useState(null);
	const [orders, setOrders] = useState(null);
	const [f, setF] = useState({ q: "", status: "", demo: "", category: "", sort: "newest", page: 1 });
	const [orderStatus, setOrderStatus] = useState("");
	const [orderPage, setOrderPage] = useState(1);
	const [orderMeta, setOrderMeta] = useState({ page: 1, pages: 1, total: 0 });
	const [orderBook, setOrderBook] = useState(null); // { id, title }
	const [error, setError] = useState("");
	const [confirm, setConfirm] = useState(null); // { title, body, label, danger, run }
	const [busy, setBusy] = useState(false);

	const loadBooks = useCallback(async () => {
		setError("");
		try {
			const params = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== "" && v !== null));
			setData((await axios.get("/api/admin/books", { params })).data);
		} catch (e) {
			setError(msg(e, "Could not load books."));
			setData((d) => d || { books: [], total: 0, page: 1, pages: 1, stats: null });
		}
	}, [f]);
	const loadOrders = useCallback(async () => {
		setError("");
		try {
			const r = (await axios.get("/api/admin/books/orders", { params: { status: orderStatus || undefined, bookId: orderBook ? orderBook.id : undefined, page: orderPage } })).data;
			setOrders(r.orders);
			setOrderMeta({ page: r.page, pages: r.pages, total: r.total });
		} catch (e) {
			setError(msg(e, "Could not load orders."));
			setOrders([]);
		}
	}, [orderStatus, orderBook, orderPage]);

	useEffect(() => {
		if (tab !== "books") return;
		const t = setTimeout(loadBooks, f.q ? 250 : 0);
		return () => clearTimeout(t);
	}, [tab, loadBooks, f.q]);
	useEffect(() => {
		if (tab === "orders") loadOrders();
	}, [tab, loadOrders]);
	useEffect(() => {
		if (router.query.tab === "orders") {
			setTab("orders");
			if (router.query.bookId) setOrderBook({ id: router.query.bookId, title: router.query.title || "this book" });
		}
	}, [router.query.tab, router.query.bookId, router.query.title]);

	const set = (name) => (e) => setF((x) => ({ ...x, [name]: e.target.value, page: name === "page" ? e.target.value : 1 }));
	const setBookStatus = async (id, next) => {
		try {
			await axios.patch(`/api/admin/books/${id}`, { status: next });
			toast.success(`Book ${next}.`);
			loadBooks();
		} catch (e) {
			toast.error(msg(e, "Could not change the status."));
		}
	};
	const doRefund = async (o) => {
		try {
			await axios.post(`/api/admin/books/orders/${o.id}/refund`);
			toast.success("Refunded.");
			loadOrders();
		} catch (e) {
			toast.error(msg(e, "The refund failed."));
		}
	};
	const refund = (o) =>
		setConfirm({ title: "Refund this payment?", body: `${money(o.amountCents, o.currency)} will be refunded to ${o.buyer ? o.buyer.email : "the buyer"} through Stripe, and their access to the book ends.`, label: "Refund", danger: true, run: () => doRefund(o) });
	const askStatus = (b, next) => {
		if (next === "published") return setBookStatus(b.id, next);
		const copy = next === "archived" ? "Archived books disappear from the store and cannot be bought. People who already bought it keep their access and all order history stays." : "Unpublished books disappear from the store until you publish them again. Existing buyers keep their access.";
		setConfirm({ title: next === "archived" ? `Archive “${b.title}”?` : `Unpublish “${b.title}”?`, body: copy, label: next === "archived" ? "Archive" : "Unpublish", danger: false, run: () => setBookStatus(b.id, next) });
	};
	const runConfirm = async () => {
		setBusy(true);
		try {
			await confirm.run();
		} finally {
			setBusy(false);
			setConfirm(null);
		}
	};

	const stats = data && data.stats;
	const books = data && data.books;
	return (
		<AdminLayout user={user} title="Books" description="The whole bookstore: every book, order and refund." actions={<Button href="/admin/books/new/" icon="ri-add-line">Add new book</Button>}>
			{stats && (
				<div className="ss-statgrid" aria-label="Bookstore overview">
					<Stat label="Total books" value={stats.books.total} />
					<Stat label="Published" value={stats.books.published} />
					<Stat label="Draft / unpublished" value={stats.books.draft} />
					<Stat label="Archived" value={stats.books.archived} />
					<Stat label="Total orders" value={stats.orders.total} />
					<Stat label="Successful purchases" value={stats.orders.paid} />
					<Stat label="Failed payments" value={stats.orders.failed} />
					<Stat label="Pending payments" value={stats.orders.pending} />
				</div>
			)}
			<div className="ss-segmented" role="tablist" aria-label="Books admin">
				{[["books", "Catalogue"], ["orders", "Orders & payments"]].map(([id, label]) => (
					<button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
						{label}
					</button>
				))}
			</div>
			{error && (
				<p className="ss-notice ss-notice--error" role="alert">
					{error} <button type="button" className="ss-linkbtn" onClick={tab === "books" ? loadBooks : loadOrders}>Retry</button>
				</p>
			)}

			{tab === "books" && (
				<>
					<div className="ss-card ss-filters">
						<div className="ss-filter ss-filter--wide">
							<label htmlFor="ab-q">Search title, author or web address</label>
							<input id="ab-q" type="search" value={f.q} maxLength={80} onChange={set("q")} />
						</div>
						<div className="ss-filter">
							<label htmlFor="ab-s">Status</label>
							<select id="ab-s" value={f.status} onChange={set("status")}>
								<option value="">All</option>
								<option value="published">Published</option>
								<option value="draft">Draft / unpublished</option>
								<option value="archived">Archived</option>
							</select>
						</div>
						<div className="ss-filter">
							<label htmlFor="ab-c">Category</label>
							<select id="ab-c" value={f.category} onChange={set("category")}>
								<option value="">All</option>
								{CATEGORIES.map((c) => (
									<option key={c.id} value={c.id}>
										{c.label}
									</option>
								))}
							</select>
						</div>
						<div className="ss-filter">
							<label htmlFor="ab-d">Demo or real</label>
							<select id="ab-d" value={f.demo} onChange={set("demo")}>
								<option value="">All</option>
								<option value="yes">Demo books</option>
								<option value="no">Real books</option>
							</select>
						</div>
						<div className="ss-filter">
							<label htmlFor="ab-o">Sort by</label>
							<select id="ab-o" value={f.sort} onChange={set("sort")}>
								<option value="newest">Newest</option>
								<option value="title">Title A-Z</option>
								<option value="price_asc">Price: low to high</option>
								<option value="price_desc">Price: high to low</option>
								<option value="sold">Most purchased</option>
							</select>
						</div>
					</div>
					{books === undefined || books === null ? (
						<GeneralLoader />
					) : books.length === 0 ? (
						<EmptyState icon="ri-book-2-line" title="No books match" description="Add a book, or change the filters." action={<Button href="/admin/books/new/">Add new book</Button>} />
					) : (
						<>
							<div className="ss-table-wrap">
								<table className="ss-table">
									<thead>
										<tr>
											<th scope="col">Book</th>
											<th scope="col">Ages / grade</th>
											<th scope="col">Subject</th>
											<th scope="col">Price</th>
											<th scope="col">Format</th>
											<th scope="col">Status</th>
											<th scope="col">Purchases</th>
											<th scope="col">Actions</th>
										</tr>
									</thead>
									<tbody>
										{books.map((b) => (
											<tr key={b.id}>
												<td>
													<div className="ss-bookrow">
														<div className="ss-admincover">
															<BookCover book={b} size="sm" />
														</div>
														<div>
															<strong>{b.title}</strong> {b.isDemo && <Badge tone="accent">Demo</Badge>}
															<br />
															<span className="ss-muted">{b.author}</span>
														</div>
													</div>
												</td>
												<td>
													{b.ageRange}
													<br />
													<span className="ss-muted">{b.gradeRange || "No grade set"}</span>
												</td>
												<td>
													{b.subjectLabel || "—"}
													<br />
													<span className="ss-muted">{b.categoryLabel}</span>
												</td>
												<td>{money(b.priceCents)}</td>
												<td>{b.format === "pdf" ? "PDF" : b.format === "external" ? "External link" : <span className="ss-muted">No file</span>}</td>
												<td>
													<Badge tone={TONE[b.status]}>{b.status}</Badge>
												</td>
												<td>{b.sold}</td>
												<td className="ss-rowactions">
													<Link href={`/admin/books/${b.id}/`}>
														<a className="ss-btn ss-btn--secondary ss-btn--sm">Edit</a>
													</Link>
													<Link href={`/books/${b.slug}/`}>
														<a className="ss-btn ss-btn--ghost ss-btn--sm" target="_blank" rel="noopener noreferrer">Preview</a>
													</Link>
													<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={() => { setOrderBook({ id: b.id, title: b.title }); setOrderPage(1); setTab("orders"); }}>
														Orders
													</button>
													{b.status !== "published" && (
														<button type="button" className="ss-btn ss-btn--sm" onClick={() => setBookStatus(b.id, "published")}>
															Publish
														</button>
													)}
													{b.status === "published" && (
														<button type="button" className="ss-btn ss-btn--secondary ss-btn--sm" onClick={() => askStatus(b, "draft")}>
															Unpublish
														</button>
													)}
													{b.status !== "archived" && (
														<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={() => askStatus(b, "archived")}>
															Archive
														</button>
													)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
							{data.pages > 1 && (
								<nav className="ss-pager" aria-label="Pagination">
									<button type="button" className="ss-btn ss-btn--secondary" disabled={data.page <= 1} onClick={() => setF((x) => ({ ...x, page: data.page - 1 }))}>
										← Previous
									</button>
									<span>
										Page {data.page} of {data.pages} · {data.total} books
									</span>
									<button type="button" className="ss-btn ss-btn--secondary" disabled={data.page >= data.pages} onClick={() => setF((x) => ({ ...x, page: data.page + 1 }))}>
										Next →
									</button>
								</nav>
							)}
						</>
					)}
				</>
			)}

			{tab === "orders" && (
				<>
					<div className="ss-card ss-filters ss-filters--compact">
						<div className="ss-filter">
							<label htmlFor="ao-s">Payment status</label>
							<select id="ao-s" value={orderStatus} onChange={(e) => { setOrderStatus(e.target.value); setOrderPage(1); }}>
								<option value="">All</option>
								<option value="paid">Paid</option>
								<option value="pending">Pending</option>
								<option value="failed">Failed</option>
								<option value="refunded">Refunded</option>
							</select>
						</div>
						{orderBook && (
							<p className="ss-derived">
								Showing orders for <strong>{orderBook.title}</strong>.{" "}
								<button type="button" className="ss-linkbtn" onClick={() => { setOrderBook(null); setOrderPage(1); }}>Show all books</button>
							</p>
						)}
					</div>
					{orders === null ? (
						<GeneralLoader />
					) : orders.length === 0 ? (
						<EmptyState icon="ri-bank-card-line" title="No orders" description="Book orders appear here." />
					) : (
						<div className="ss-table-wrap">
							<table className="ss-table">
								<thead>
									<tr>
										<th scope="col">Order</th>
										<th scope="col">Date</th>
										<th scope="col">Customer</th>
										<th scope="col">Book</th>
										<th scope="col">Amount</th>
										<th scope="col">Payment</th>
										<th scope="col">Refund</th>
									</tr>
								</thead>
								<tbody>
									{orders.map((o) => (
										<tr key={o.id}>
											<td>
												<code title={o.id}>{o.id.slice(0, 8)}</code>
											</td>
											<td>{shortDate(o.paidAt || o.createdAt)}</td>
											<td>{o.buyer ? o.buyer.email : "—"}</td>
											<td>{o.book ? o.book.title : "—"}</td>
											<td>{money(o.amountCents, o.currency)}</td>
											<td>
												<Badge tone={TONE[o.status]}>{o.status}</Badge>
												{o.failureReason && (
													<>
														<br />
														<span className="ss-muted">{o.failureReason}</span>
													</>
												)}
											</td>
											<td>
												{o.status === "refunded" ? (
													<span className="ss-muted">Refunded {shortDate(o.refundedAt)}</span>
												) : o.status === "paid" && o.method === "card" ? (
													<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={() => refund(o)}>
														Refund via Stripe
													</button>
												) : (
													<span className="ss-muted">—</span>
												)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
					{orderMeta.pages > 1 && (
						<nav className="ss-pager" aria-label="Orders pagination">
							<button type="button" className="ss-btn ss-btn--secondary" disabled={orderMeta.page <= 1} onClick={() => setOrderPage(orderMeta.page - 1)}>
								← Previous
							</button>
							<span>
								Page {orderMeta.page} of {orderMeta.pages} · {orderMeta.total} orders
							</span>
							<button type="button" className="ss-btn ss-btn--secondary" disabled={orderMeta.page >= orderMeta.pages} onClick={() => setOrderPage(orderMeta.page + 1)}>
								Next →
							</button>
						</nav>
					)}
				</>
			)}
			<ConfirmDialog open={!!confirm} title={confirm ? confirm.title : ""} confirmLabel={confirm ? confirm.label : "Confirm"} danger={confirm ? confirm.danger : false} busy={busy} onConfirm={runConfirm} onCancel={() => !busy && setConfirm(null)}>
				<p>{confirm ? confirm.body : ""}</p>
			</ConfirmDialog>
		</AdminLayout>
	);
};

export default AdminBooks;
