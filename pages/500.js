import React from "react";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import { Button } from "@/components/ui";
import { EmptyArt } from "@/components/ui/Illustration";

const ServerError = ({ user }) => (
	<>
		<Navbar user={user} />
		<main className="ss-container ss-errorpage" role="alert">
			<EmptyArt className="ss-errorpage__art" />
			<h1>Something went wrong on our side</h1>
			<p>Please try again in a moment. If it keeps happening, tell us on the contact page.</p>
			<div className="ss-errorpage__actions">
				<Button href="/" icon="ri-home-4-line">Home</Button>
				<Button href="/contact-us/" variant="secondary">Contact us</Button>
			</div>
		</main>
		<Footer />
	</>
);

export default ServerError;
