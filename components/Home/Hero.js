import React from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { HeroScene } from "@/components/ui/Illustration";
import { CATEGORIES } from "@/lib/books/taxonomy";

// Book-first homepage hero. Copy is SharpStudy's own (the former hero's mission line is kept in the
// courses band further down); there are no statistics or claims here that need data.
const Hero = () => (
	<section className="ss-hero" aria-labelledby="hero-title">
		<div className="ss-container ss-hero__grid">
			<div className="ss-hero__copy">
				<span className="ss-eyebrow">
					<i className="ri-book-open-line" aria-hidden="true"></i> Books, courses and live classes
				</span>
				<h1 id="hero-title">
					Read it. Try it. <span>Love learning.</span>
				</h1>
				<p className="ss-hero__lead">
					Find books for every age and grade, then keep growing with project-based courses and live classes, all in one friendly place.
				</p>
				<form action="/books/" method="get" role="search" className="ss-booksearch ss-hero__search">
					<label htmlFor="hero-book-search" className="visually-hidden">
						Search books by title, author, subject or category
					</label>
					<input id="hero-book-search" name="q" type="search" maxLength={80} placeholder="Search books: title, author, subject…" autoComplete="off" />
					<button type="submit" className="ss-btn">
						<i className="ri-search-line" aria-hidden="true"></i> Search
					</button>
				</form>
				<div className="ss-hero__ctas">
					<Button href="/books/" size="lg" iconRight="ri-arrow-right-line">
						Explore Books
					</Button>
					<Button href="/courses/" size="lg" variant="secondary" icon="ri-slideshow-2-line">
						Browse courses
					</Button>
				</div>
				<ul className="ss-hero__chips" aria-label="Book categories">
					{CATEGORIES.filter((c) => c.id !== "general").map((c) => (
						<li key={c.id}>
							<Link href={`/books/?category=${c.id}`}>
								<a>
									<i className={c.icon} aria-hidden="true"></i>
									{c.label}
								</a>
							</Link>
						</li>
					))}
				</ul>
			</div>
			<div className="ss-hero__art">
				<HeroScene className="ss-hero__scene" />
			</div>
		</div>
	</section>
);

export default Hero;
