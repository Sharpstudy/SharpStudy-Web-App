import React from "react";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";

// Shell for the telecaller dashboard. The page gate (pages/_app.js + lib/auth/pageAccess.js) keeps other accounts off the screen,
// and every API behind it re-checks access from the database, so this layout grants nothing.
const TelecallerLayout = ({ user, title, description, children }) => (
	<>
		<Navbar user={user} />
		<div className="ss-dash">
			<div className="ss-container ss-container--wide">
				<main className="ss-dash__main" style={{ paddingTop: 24, paddingBottom: 40 }}>
					<div className="ss-dash__head">
						<div style={{ minWidth: 0 }}>
							<h1>{title}</h1>
							{description && <p>{description}</p>}
						</div>
					</div>
					{children}
				</main>
			</div>
		</div>
		<Footer />
	</>
);

export default TelecallerLayout;
