import React from "react";
import Head from "next/head";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import GalleryHero from "@/components/Gallery/GalleryHero";
import GalleryExplorer from "@/components/Gallery/GalleryExplorer";
import { Button } from "@/components/ui";
import { BookFreeDemoButton } from "@/components/FreeDemo/FreeDemoProvider";

// /gallery/: premium gallery of the real SharpStudy site. Content comes from lib/gallery/showcase.js (screenshots, labelled illustrations)
// and lib/gallery/items.js (consented photographs; none yet). Nothing here is fetched, so the page needs no API.
const Gallery = ({ user }) => (
	<>
		<Head>
			<title>Gallery | SharpStudy</title>
			<meta name="description" content="Explore the SharpStudy programs, platform and learning experiences in pictures." />
		</Head>
		<Navbar user={user} />
		<main id="gallery-main">
			<GalleryHero />
			<GalleryExplorer />
			<section className="ss-section ss-section--tight" aria-labelledby="gallery-cta-title">
				<div className="ss-container">
					<div className="ss-cta">
						<div>
							<h2 id="gallery-cta-title">Your Learning Journey Starts Here</h2>
							<p>Discover SharpStudy programs and explore new ways to learn, practice and grow.</p>
						</div>
						<div className="ss-cta__actions">
							<BookFreeDemoButton source="gallery_cta" size="lg">
								Book a Free Demo
							</BookFreeDemoButton>
							<Button href="/programs/" variant="light" size="lg">
								Explore Programs
							</Button>
						</div>
					</div>
				</div>
			</section>
		</main>
		<Footer />
	</>
);

export default Gallery;
