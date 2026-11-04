import React from "react";
import Head from "next/head";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import { PageHeader } from "@/components/ui";
import BookCover from "@/components/Books/BookCover";
import PayButton from "@/components/Books/PayButton";
import { money } from "@/components/Books/format";
import { loadDetail } from "@/lib/books/pageActor";
import { authUrlFor, bookCheckoutPath } from "@/lib/books/redirect";

const BookCheckout = ({ user, data }) => {
	const { book, ownership } = data;
	return (
		<>
			<Head>
				<title>{`Checkout: ${book.title} | SharpStudy Books`}</title>
				<meta name="robots" content="noindex" />
			</Head>
			<Navbar user={user} />
			<main>
				<PageHeader title="Checkout" crumbs={[{ href: "/books/", label: "Books" }, { href: `/books/${book.slug}/`, label: book.title }, { label: "Checkout" }]} />
				<div className="ss-container ss-container--wide ss-student">
					<div className="ss-checkout">
						<section aria-labelledby="item-title">
							<h2 id="item-title" className="ss-checkout__title">
								Your book
							</h2>
							<div className="ss-card ss-bookline">
								<BookCover book={book} size="sm" />
								<div>
									<h3>{book.title}</h3>
									<p className="ss-muted">by {book.author}</p>
									<p className="ss-muted">
										{book.ageRange}
										{book.gradeRange ? ` · ${book.gradeRange}` : ""}
									</p>
								</div>
								<strong>{money(book.priceCents)}</strong>
							</div>
						</section>
						<aside className="ss-card ss-summary" aria-label="Order summary">
							<h2>Order summary</h2>
							<div className="ss-summary__row ss-summary__total">
								<span>Total</span>
								<strong>{money(book.priceCents)}</strong>
							</div>
							{ownership.pending ? (
								<p role="status">Your payment is still processing. You will not be charged twice; the book will appear in My Books when it succeeds.</p>
							) : (
								<PayButton book={book} />
							)}
							<p className="ss-summary__note">
								<i className="ri-lock-line" aria-hidden="true"></i> Secure payment via Stripe. The price is set by SharpStudy, and access is added only after the payment is confirmed.
							</p>
						</aside>
					</div>
				</div>
			</main>
			<Footer />
		</>
	);
};

// Signed out -> sign in / register, then come straight back here. Already owned -> read, never charge again.
export async function getServerSideProps({ req, params, res }) {
	const { actor, data } = await loadDetail(req, params.slug);
	res.setHeader("Cache-Control", "private, no-store");
	if (!actor) return { redirect: { destination: authUrlFor(bookCheckoutPath(params.slug)), permanent: false } };
	if (!data || (data.book.status && data.book.status !== "published")) return { notFound: true };
	if (data.ownership.owned) return { redirect: { destination: `/learning/my-books/read/${encodeURIComponent(data.book.slug)}/`, permanent: false } };
	return { props: { data } };
}

export default BookCheckout;
