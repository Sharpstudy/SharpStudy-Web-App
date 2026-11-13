import React from "react";
import Head from "next/head";
import Link from "next/link";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import { PageHeader } from "@/components/ui";
import BookCover from "@/components/Books/BookCover";
import BuyBox from "@/components/Books/BuyBox";
import BookShelf from "@/components/Books/BookShelf";
import { booksHref, shortDate } from "@/components/Books/format";
import { loadDetail } from "@/lib/books/pageActor";

const Fact = ({ label, children }) =>
	children ? (
		<div>
			<dt>{label}</dt>
			<dd>{children}</dd>
		</div>
	) : null;

const BookPage = ({ user, data }) => {
	const { book, ownership, progress, related } = data;
	return (
		<>
			<Head>
				<title>{`${book.title} by ${book.author} | SharpStudy Books`}</title>
				<meta name="description" content={(book.description || `${book.title} by ${book.author}`).slice(0, 160)} />
			</Head>
			<Navbar user={user} />
			<main>
				<PageHeader title={book.title} description={`by ${book.author}`} crumbs={[{ href: "/", label: "Home" }, { href: "/books/", label: "Books" }, { label: book.title }]} />
				<div className="ss-container ss-container--wide ss-student">
					{book.isDemo && (
						<p className="ss-notice" role="note">
							<strong>Demo book.</strong> This is a fictional sample product used to demonstrate the SharpStudy bookstore. Its price is a placeholder, and it is not a real publication.
						</p>
					)}
					{book.status && book.status !== "published" && (
						<p className="ss-notice" role="status">
							Administrator preview: this book is <strong>{book.status}</strong> and is not visible to the public.
						</p>
					)}
					<div className="ss-bookdetail">
						<div className="ss-bookdetail__cover">
							<BookCover book={book} size="lg" />
						</div>
						<div className="ss-bookdetail__main">
							<div className="ss-bookcard__tags">
								{book.categoryLabel && (
									<Link href={booksHref({ category: book.category })}>
										<a className="ss-badge">{book.categoryLabel}</a>
									</Link>
								)}
								{book.ageGroup && (
									<Link href={booksHref({ ageGroup: book.ageGroup })}>
										<a className="ss-badge ss-badge--soft">{book.ageGroupLabel}</a>
									</Link>
								)}
							</div>
							<h2 className="ss-bookdetail__heading">About this book</h2>
							<p className="ss-bookdetail__desc">{book.description || "No description has been added yet."}</p>
							{progress && (
								<p className="ss-notice" role="status">
									You are {progress.percent}% through this book (page {progress.position} of {progress.total}).
								</p>
							)}
							<h2 className="ss-bookdetail__heading">Who it is for</h2>
							<dl className="ss-facts">
								<Fact label="Recommended ages">{book.ageRange}</Fact>
								<Fact label="Age groups">
									{book.ageGroups && book.ageGroups.length > 0 && book.ageGroups.length < 7 ? (
										<ul className="ss-taglist">
											{book.ageGroups.map((g) => (
												<li key={g.id}>
													<Link href={booksHref({ ageGroup: g.id })}>
														<a className="ss-chip">{g.label}</a>
													</Link>
												</li>
											))}
										</ul>
									) : (
										"Suitable for all ages"
									)}
								</Fact>
								<Fact label="Grade level">{book.gradeRange}</Fact>
								<Fact label="Subject">{book.subjectLabel}</Fact>
								<Fact label="Reading level">{book.readingLevelLabel}</Fact>
								<Fact label="Language">{book.languageName}</Fact>
								<Fact label="Tags">
									{book.tags && book.tags.length > 0 && (
										<ul className="ss-taglist">
											{book.tags.map((t) => (
												<li key={t}>
													<Link href={booksHref({ q: t })}>
														<a className="ss-chip">{t}</a>
													</Link>
												</li>
											))}
										</ul>
									)}
								</Fact>
								<Fact label="Publisher">{book.publisher}</Fact>
								<Fact label="Publication year">{book.publishedYear}</Fact>
								<Fact label="Format">{book.format === "pdf" ? "PDF, read online in your dashboard" : book.format === "external" ? "Online reading resource" : null}</Fact>
								{ownership.purchasedAt && <Fact label="Purchased">{shortDate(ownership.purchasedAt)}</Fact>}
							</dl>
							<p className="ss-muted ss-bookdetail__hint">Age and grade are guides, not rules. Choose what suits the reader&apos;s interests and confidence.</p>
						</div>
						<BuyBox book={book} ownership={ownership} user={user} progress={progress} />
					</div>
				</div>
				<BookShelf wide id="related-books" eyebrow="Related" title="Related titles" description="Similar ages, grades and subjects." books={related} user={user} />
			</main>
			<Footer />
		</>
	);
};

export async function getServerSideProps({ req, params, res }) {
	const { data } = await loadDetail(req, params.slug);
	if (!data) return { notFound: true };
	// Personalised (ownership, progress): never shared between visitors.
	res.setHeader("Cache-Control", "private, no-store");
	return { props: { data } };
}

export default BookPage;
