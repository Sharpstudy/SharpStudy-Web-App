import React, { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import { PageHeader, EmptyState, Button } from "@/components/ui";
import AgeGroupCards from "@/components/Books/AgeGroupCards";
import CatalogFilters from "@/components/Books/CatalogFilters";
import BookCard from "@/components/Books/BookCard";
import { booksHref } from "@/components/Books/format";
import repo from "@/lib/books/repo";
import { listCatalog } from "@/lib/books/service";
import { plainProps } from "@/lib/books/pageActor";
import { ageGroupById, categoryLabel, subjectLabel, gradeLabel, readingLevelLabel, languageName } from "@/lib/books/taxonomy";

const Books = ({ user, result, error }) => {
	const router = useRouter();
	const [navigating, setNavigating] = useState(false);
	useEffect(() => {
		const start = () => setNavigating(true);
		const done = () => setNavigating(false);
		router.events.on("routeChangeStart", start);
		router.events.on("routeChangeComplete", done);
		router.events.on("routeChangeError", done);
		return () => {
			router.events.off("routeChangeStart", start);
			router.events.off("routeChangeComplete", done);
			router.events.off("routeChangeError", done);
		};
	}, [router.events]);

	const f = (result && result.filters) || {};
	// Each active filter is a removable chip: a link to this same search without that one parameter.
	const params = { q: f.q, ageGroup: f.ageGroup, age: f.age, grade: f.grade, category: f.category, subject: f.subject, level: f.level, language: f.language, price: f.price, sort: f.sort !== "newest" && f.sort !== "relevance" ? f.sort : undefined };
	const chipDefs = [
		["q", f.q && `“${f.q}”`],
		["ageGroup", f.ageGroup && ageGroupById(f.ageGroup).label],
		["age", f.age != null && `Age ${f.age}`],
		["grade", f.grade != null && gradeLabel(f.grade)],
		["category", f.category && categoryLabel(f.category)],
		["subject", f.subject && subjectLabel(f.subject)],
		["level", f.level && readingLevelLabel(f.level)],
		["language", f.language && languageName(f.language)],
		["price", f.price && (f.price === "free" ? "Free" : "Paid")],
	].filter(([, label]) => label);
	const active = chipDefs.map(([, label]) => label);
	const carry = { ...params, page: undefined };

	return (
		<>
			<Head>
				<title>Books | SharpStudy</title>
				<meta name="description" content="Browse study guides, workbooks and stories by age, grade, subject and category." />
			</Head>
			<Navbar user={user} />
			<main>
				<PageHeader title="Books" description="Find the right book by age, grade and subject." crumbs={[{ href: "/", label: "Home" }, { label: "Books" }]} />
				<div className="ss-container ss-container--wide ss-student">
					<AgeGroupCards active={f.ageGroup} extra={{ q: f.q, category: f.category, subject: f.subject, grade: f.grade, level: f.level }} heading={false} />
					<CatalogFilters filters={{ ...f, sort: f.sort || "newest" }} languages={(result && result.facets && result.facets.languages) || []} />
					{chipDefs.length > 0 && (
						<ul className="ss-filterchips" aria-label="Active filters">
							{chipDefs.map(([key, label]) => (
								<li key={key}>
									<Link href={booksHref({ ...params, [key]: undefined, page: undefined })}>
										<a className="ss-fchip" aria-label={`Remove filter: ${label}`}>
											{label} <i className="ri-close-line" aria-hidden="true"></i>
										</a>
									</Link>
								</li>
							))}
							<li>
								<Link href="/books/">
									<a className="ss-fchip ss-fchip--reset">
										<i className="ri-refresh-line" aria-hidden="true"></i> Reset all
									</a>
								</Link>
							</li>
						</ul>
					)}

					{error ? (
						<div role="alert">
							<EmptyState icon="ri-error-warning-line" title="We could not load the books" description={error} action={<Button href="/books/">Try again</Button>} />
						</div>
					) : (
						<>
							<p className="ss-resultline" role="status" aria-live="polite">
								{navigating ? "Loading books…" : `${result.total} book${result.total === 1 ? "" : "s"}${active.length ? ` for ${active.join(", ")}` : ""}`}
							</p>
							{navigating ? (
								<ul className="ss-bookgrid" aria-hidden="true">
									{Array.from({ length: 8 }).map((_, i) => (
										<li key={i}>
											<div className="ss-bookcard ss-bookcard--skeleton" />
										</li>
									))}
								</ul>
							) : result.books.length === 0 ? (
								<EmptyState
									icon="ri-book-2-line"
									title="No books match yet"
									description="Try a different age group, remove a filter, or search by title or author. Books that suit several ages appear in each of them."
									action={<Button href="/books/">Clear filters</Button>}
								/>
							) : (
								<ul className="ss-bookgrid">
									{result.books.map((b) => (
										<li key={b.id}>
											<BookCard book={b} user={user} />
										</li>
									))}
								</ul>
							)}
							{result.pages > 1 && !navigating && (
								<nav className="ss-pager" aria-label="Pagination">
									{result.page > 1 ? (
										<Link href={booksHref({ ...carry, page: result.page - 1 })}>
											<a className="ss-btn ss-btn--secondary">← Previous</a>
										</Link>
									) : (
										<span />
									)}
									<span>
										Page {result.page} of {result.pages}
									</span>
									{result.page < result.pages ? (
										<Link href={booksHref({ ...carry, page: result.page + 1 })}>
											<a className="ss-btn ss-btn--secondary">Next →</a>
										</Link>
									) : (
										<span />
									)}
								</nav>
							)}
						</>
					)}
				</div>
			</main>
			<Footer />
		</>
	);
};

export async function getServerSideProps({ query, res }) {
	// `user` is supplied to every page by _app.getInitialProps (verified token -> database).
	try {
		const result = plainProps(await listCatalog(repo, query));
		// Same URL shows different buttons to signed-in users, so keep it out of shared caches.
		res.setHeader("Cache-Control", "private, no-store");
		return { props: { result } };
	} catch (e) {
		if (e && e.status === 400) {
			// A malformed or manipulated query: show the unfiltered catalogue's error state, not a stack trace.
			return { props: { result: null, error: e.message } };
		}
		console.error(`[books] catalogue: ${e && e.message}`);
		return { props: { result: null, error: "Something went wrong while loading the catalogue. Please try again in a moment." } };
	}
}

export default Books;
