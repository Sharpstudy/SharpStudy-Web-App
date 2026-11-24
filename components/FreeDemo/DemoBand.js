import React from "react";
import { BookFreeDemoButton } from "./FreeDemoProvider";

// A contextual call-to-action band near the bottom of a page (same look as the site's other final CTAs). One button, same shared dialog.
const DemoBand = ({ source, program, title = "Not sure where to start?", text = "Book a free demo class and see how SharpStudy learning works.", label = "Book a Free Demo" }) => (
	<section className="ss-section ss-section--tight" aria-label="Free demo class">
		<div className="ss-container">
			<div className="ss-cta">
				<div>
					<h2>{title}</h2>
					<p>{text}</p>
				</div>
				<div className="ss-cta__actions">
					<BookFreeDemoButton source={source} program={program} variant="primary" size="lg">
						{label}
					</BookFreeDemoButton>
				</div>
			</div>
		</div>
	</section>
);

export default DemoBand;
