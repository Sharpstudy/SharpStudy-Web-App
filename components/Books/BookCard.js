import React from "react";
import Link from "next/link";
import BookCover from "./BookCover";
import { money } from "./format";
import { authUrlFor, bookCheckoutPath } from "@/lib/books/redirect";

// Buy Now sends a signed-out visitor to sign in / register and returns them to THIS book's checkout.
export const buyHref = (book, user) => (user ? bookCheckoutPath(book.slug) : authUrlFor(bookCheckoutPath(book.slug)));

const TONE = { "baby-toddler": "peach", preschool: "sun", "young-readers": "mint", "independent-readers": "sky", "middle-secondary": "lav", "senior-secondary": "sky", adult: "lav" };

const BookCard = ({ book, user }) => (
	<article className={`ss-bookcard tone-${TONE[book.ageGroup] || "sky"}`}>
		<Link href={`/books/${book.slug}/`}>
			<a className="ss-bookcard__media" tabIndex={-1} aria-hidden="true">
				<BookCover book={book} />
			</a>
		</Link>
		<div className="ss-bookcard__body">
			<div className="ss-bookcard__tags">
				{book.categoryLabel && <span className="ss-badge">{book.categoryLabel}</span>}
				<span className="ss-badge ss-badge--soft">{book.ageRange}</span>
				{book.free && <span className="ss-badge ss-badge--success">Free</span>}
				{book.isDemo && <span className="ss-badge ss-badge--accent" title="A fictional sample product">Demo</span>}
			</div>
			<h3 className="ss-bookcard__title">
				<Link href={`/books/${book.slug}/`}>
					<a>{book.title}</a>
				</Link>
			</h3>
			<p className="ss-bookcard__author">by {book.author}</p>
			<p className="ss-bookcard__price">
				{money(book.priceCents)}
				{book.isDemo && !book.free && <span className="ss-muted"> · demo price</span>}
			</p>
			<div className="ss-bookcard__actions">
				<Link href={`/books/${book.slug}/`}>
					<a className="ss-btn ss-btn--secondary ss-btn--sm" aria-label={`View book: ${book.title}`}>
						View Book
					</a>
				</Link>
				<Link href={buyHref(book, user)}>
					<a className="ss-btn ss-btn--sm" aria-label={`Buy now: ${book.title}`}>
						{book.free ? "Get it free" : "Buy Now"}
					</a>
				</Link>
			</div>
		</div>
	</article>
);

export default BookCard;
