import React from "react";
import Link from "next/link";
import { money } from "./format";
import { authUrlFor, bookCheckoutPath } from "@/lib/books/redirect";

export const readerPath = (slug, fresh = false) => `/learning/my-books/read/${encodeURIComponent(slug)}/${fresh ? "?start=1" : ""}`;

// The purchase panel on a book page. What it offers depends on the SERVER-reported ownership:
//   not signed in  -> Buy Now goes through /auth and returns to this book's checkout
//   owns the book  -> Continue Reading (never a charge)
//   payment pending-> a notice, no second charge
const BuyBox = ({ book, ownership, user, progress }) => {
	const buy = user ? bookCheckoutPath(book.slug) : authUrlFor(bookCheckoutPath(book.slug));
	return (
		<aside className="ss-card ss-buybox" aria-label="Buy this book">
			<p className="ss-buybox__price">{money(book.priceCents)}</p>
			{ownership.owned ? (
				<>
					<p className="ss-buybox__owned" role="status">
						<i className="ri-checkbox-circle-fill" aria-hidden="true"></i> Already purchased
					</p>
					<Link href={readerPath(book.slug)}>
						<a className="ss-btn ss-btn--lg ss-btn--block">
							<i className="ri-book-open-line" aria-hidden="true"></i> {progress && progress.percent < 100 ? "Continue Reading" : "Read Book"}
						</a>
					</Link>
				</>
			) : ownership.pending ? (
				<p className="ss-buybox__note" role="status">
					Your payment is still processing. The book will appear in <Link href="/learning/my-books/"><a>My Books</a></Link> once it succeeds. You will not be charged twice.
				</p>
			) : (
				<>
					<Link href={buy}>
						<a className="ss-btn ss-btn--lg ss-btn--block">
							<i className="ri-shopping-bag-3-line" aria-hidden="true"></i> {book.free ? "Get it free" : "Buy Now"}
						</a>
					</Link>
					{!user && <p className="ss-buybox__note">You will be asked to sign in or create a student account, then return to checkout for this book.</p>}
				</>
			)}
			{book.hasPreview && (
				<a className="ss-btn ss-btn--secondary ss-btn--block" href={`/api/books/${book.id}/preview`} target="_blank" rel="noopener noreferrer">
					<i className="ri-eye-line" aria-hidden="true"></i> Read a free preview
				</a>
			)}
			<p className="ss-buybox__fine">
				<i className="ri-lock-line" aria-hidden="true"></i> Secure payment via Stripe. Access is added to your account after the payment is confirmed.
			</p>
		</aside>
	);
};

export default BuyBox;
