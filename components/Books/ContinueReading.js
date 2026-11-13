import React from "react";
import Link from "next/link";
import BookCover from "./BookCover";
import { readerPath } from "./BuyBox";
import { ProgressBar } from "@/components/ui";

// "Continue Reading": the books the student has actually started and not finished, most recently read first.
// `items` come from /api/books/mine (real progress only). Renders nothing when there is nothing to continue.
export const startedBooks = (items = []) =>
	items
		.filter((it) => it.progress && it.progress.percent < 100 && it.canRead && it.access === "active")
		.sort((a, b) => new Date(b.progress.updatedAt || 0) - new Date(a.progress.updatedAt || 0));

const ContinueReading = ({ items, limit = 3 }) => {
	const list = startedBooks(items).slice(0, limit);
	if (list.length === 0) return null;
	return (
		<section className="ss-continue" aria-labelledby="continue-title">
			<h2 id="continue-title">Continue reading</h2>
			<ul>
				{list.map((it) => (
					<li key={it.orderId} className="ss-card ss-continue__item">
						<BookCover book={it.book} size="sm" />
						<div>
							<h3>{it.book.title}</h3>
							<p className="ss-muted">
								Page {it.progress.position} of {it.progress.total}
							</p>
							<ProgressBar value={it.progress.percent} label={`Progress in ${it.book.title}`} tone="success" />
							<Link href={readerPath(it.book.slug)}>
								<a className="ss-btn ss-btn--sm">Continue Reading</a>
							</Link>
						</div>
					</li>
				))}
			</ul>
		</section>
	);
};

// Self-loading version for pages that do not already fetch the library (My Courses). Any failure just hides it.
export const ContinueReadingLoader = () => {
	const [items, setItems] = React.useState(null);
	React.useEffect(() => {
		let gone = false;
		import("axios").then(({ default: axios }) =>
			axios
				.get("/api/books/mine", { params: { status: "reading" } })
				.then((r) => !gone && setItems(r.data.items))
				.catch(() => {})
		);
		return () => {
			gone = true;
		};
	}, []);
	return items ? <ContinueReading items={items} /> : null;
};

export default ContinueReading;
