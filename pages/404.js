import React from "react";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import { Button } from "@/components/ui";
import { EmptyArt } from "@/components/ui/Illustration";

// Friendly "page not found". Only presentation: no data is loaded.
const NotFound = ({ user }) => (
	<>
		<Navbar user={user} />
		<main className="ss-container ss-errorpage">
			<EmptyArt className="ss-errorpage__art" />
			<h1>We could not find that page</h1>
			<p>The link may be old or mistyped. Let us help you find something to read or learn.</p>
			<div className="ss-errorpage__actions">
				<Button href="/books/" icon="ri-book-open-line">Explore Books</Button>
				<Button href="/courses/" variant="secondary" icon="ri-slideshow-2-line">Browse courses</Button>
				<Button href="/" variant="ghost">Home</Button>
			</div>
		</main>
		<Footer />
	</>
);

export default NotFound;
