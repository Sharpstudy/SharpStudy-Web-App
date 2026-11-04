import React from "react";
import Link from "next/link";
import { SectionHeader, Button } from "@/components/ui";
import { CATEGORIES } from "@/lib/books/taxonomy";
import AgeGroupCards from "./AgeGroupCards";
import BookShelf from "./BookShelf";
import { booksHref } from "./format";

const TONES = ["peach", "sky", "mint", "lav", "sun", "peach", "sky"];

// The homepage bookstore: Explore by Age, Featured, New and (when real sales exist) Popular shelves, and
// subject tiles. Every number shown comes from the catalogue API; `sections` may be null (the bookstore
// could not be loaded), in which case the discovery shell (age cards + subjects) still renders.
const HomeBooks = ({ sections, user }) => {
	const counts = (sections && sections.categoryCounts) || {};
	return (
		<>
			<section className="ss-section ss-section--tight" id="by-age" aria-labelledby="by-age-title">
				<div className="ss-container">
					<SectionHeader
						eyebrow="Explore Books by Age"
						title={<span id="by-age-title">Pick an age, find the right books</span>}
						description="Age is a starting point. Many books suit several ages and grades, so you will see overlaps."
						action={<Button href="/books/" variant="ghost" iconRight="ri-arrow-right-line">All books</Button>}
					/>
					<AgeGroupCards heading={false} />
				</div>
			</section>

			{!sections && (
				<section className="ss-section ss-section--tight" aria-label="Books unavailable">
					<div className="ss-container">
						<p className="ss-notice" role="status">
							Our book shelves are temporarily unavailable. You can still search above or <Link href="/books/"><a>open the full catalogue</a></Link> in a moment.
						</p>
					</div>
				</section>
			)}
			{sections && sections.total === 0 && (
				<section className="ss-section ss-section--tight" aria-label="No books yet">
					<div className="ss-container">
						<p className="ss-notice" role="status">
							The bookstore is stocking its shelves. New titles will appear here soon.
						</p>
					</div>
				</section>
			)}
			{sections && sections.total > 0 && (
				<>
					<BookShelf id="featured-books" eyebrow="Featured" title="Featured books" description="Hand-picked by the SharpStudy team." books={sections.featured} user={user} href="/books/" />
					<BookShelf id="new-books" eyebrow="New" title="New books" description="The latest additions to the shelves." books={sections.newArrivals} user={user} href={booksHref({ sort: "newest" })} />
					<BookShelf id="popular-books" eyebrow="Popular" title="Popular with readers" description="The books readers have bought most." books={sections.popular} user={user} href={booksHref({ sort: "popular" })} />
				</>
			)}

			<section className="ss-section ss-section--tight" aria-labelledby="subjects-title">
				<div className="ss-container">
					<SectionHeader eyebrow="Explore by subject" title={<span id="subjects-title">What do you feel like learning?</span>} description="Browse the shelves by subject and category." />
					<ul className="ss-subjects">
						{CATEGORIES.map((c, i) => (
							<li key={c.id}>
								<Link href={booksHref({ category: c.id })}>
									<a className={`ss-subject tone-${TONES[i % TONES.length]}`}>
										<span className="ss-subject__icon" aria-hidden="true">
											<i className={c.icon}></i>
										</span>
										<span className="ss-subject__name">{c.label}</span>
										{counts[c.id] > 0 && <span className="ss-subject__count">{counts[c.id]} book{counts[c.id] === 1 ? "" : "s"}</span>}
									</a>
								</Link>
							</li>
						))}
					</ul>
				</div>
			</section>

			<section className="ss-section ss-section--tight" aria-labelledby="ways-title">
				<div className="ss-container">
					<SectionHeader align="center" eyebrow="Two ways to learn" title={<span id="ways-title">Read on your own, or learn with a teacher</span>} />
					<div className="ss-ways">
						<article className="ss-way ss-way--books">
							<span className="ss-way__icon" aria-hidden="true"><i className="ri-book-2-line"></i></span>
							<h3>Books</h3>
							<p>Buy a book once and read it in your dashboard on any device. Your place is saved as you go.</p>
							<Button href="/books/" iconRight="ri-arrow-right-line">Explore Books</Button>
						</article>
						<article className="ss-way ss-way--courses">
							<span className="ss-way__icon" aria-hidden="true"><i className="ri-slideshow-2-line"></i></span>
							<h3>Courses</h3>
							<p>Video lessons, resources, quizzes and live classes from instructors, with certificates when you finish.</p>
							<Button href="/courses/" variant="secondary" iconRight="ri-arrow-right-line">Browse courses</Button>
						</article>
					</div>
				</div>
			</section>
		</>
	);
};

export default HomeBooks;
