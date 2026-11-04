import React from "react";
import { SectionHeader, Button, EmptyState } from "@/components/ui";
import BookCard from "./BookCard";

// A titled grid of book cards. Renders nothing when there is nothing to show and `hideEmpty` is set.
const BookShelf = ({ id, eyebrow, title, description, books, user, href, hideEmpty = true, emptyAction, wide = false }) => {
	if ((!books || books.length === 0) && hideEmpty) return null;
	return (
		<section className="ss-section ss-section--tight" aria-labelledby={`${id}-title`}>
			<div className={wide ? "ss-container ss-container--wide" : "ss-container"}>
				<SectionHeader
					eyebrow={eyebrow}
					title={<span id={`${id}-title`}>{title}</span>}
					description={description}
					action={href ? <Button href={href} variant="ghost" iconRight="ri-arrow-right-line">See all</Button> : undefined}
				/>
				{books && books.length > 0 ? (
					<ul className="ss-bookgrid">
						{books.map((b) => (
							<li key={b.id}>
								<BookCard book={b} user={user} />
							</li>
						))}
					</ul>
				) : (
					<EmptyState icon="ri-book-2-line" title="No books here yet" description="Check back soon." action={emptyAction} />
				)}
			</div>
		</section>
	);
};

export default BookShelf;
