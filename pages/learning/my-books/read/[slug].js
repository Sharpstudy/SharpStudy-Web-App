import React from "react";
import Head from "next/head";
import StudentLayout from "@/components/Learning/StudentLayout";
import PdfReader from "@/components/Books/PdfReader";
import { Button, EmptyState } from "@/components/ui";
import { loadDetail } from "@/lib/books/pageActor";
import { authUrlFor } from "@/lib/books/redirect";

const Read = ({ user, book, startPage }) => (
	<StudentLayout user={user} section="learning" title={book.title} description={`by ${book.author}`}>
		<Head>
			<meta name="robots" content="noindex" />
		</Head>
		{book.format === "pdf" ? (
			<PdfReader book={{ id: book.id, title: book.title }} initialPage={startPage} />
		) : book.externalUrl ? (
			<EmptyState
				icon="ri-external-link-line"
				title="Read this book online"
				description="This title is read on the publisher's site. It opens in a new tab."
				action={
					<Button href={book.externalUrl} external>
						Open Book
					</Button>
				}
			/>
		) : (
			<EmptyState icon="ri-book-2-line" title="This book cannot be opened right now" description="Its file is not available. Please contact support if this continues." action={<Button href="/learning/my-books/">Back to My Books</Button>} />
		)}
	</StudentLayout>
);

// Only an account with a paid order for this book gets this page; the file itself is separately
// authorised on every request to /api/books/[id]/content.
export async function getServerSideProps({ req, params, query, res }) {
	res.setHeader("Cache-Control", "private, no-store");
	const { actor, data } = await loadDetail(req, params.slug);
	if (!actor) return { redirect: { destination: authUrlFor(`/learning/my-books/read/${params.slug}/`), permanent: false } };
	if (!data) return { notFound: true };
	if (!data.ownership.owned) return { redirect: { destination: `/books/${encodeURIComponent(data.book.slug)}/`, permanent: false } };
	const resume = data.progress && !query.start ? data.progress.position : 1;
	return { props: { book: data.book, startPage: resume } };
}

export default Read;
