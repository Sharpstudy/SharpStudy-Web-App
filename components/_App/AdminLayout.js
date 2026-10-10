import React from "react";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import AdminSideNav from "@/components/_App/AdminSideNav";

// Admin shell. AdminSideNav keeps the original non-admin redirect.
const AdminLayout = ({ user, title, description, actions, children }) => (
	<>
		<Navbar user={user} />
		<div className="ss-dash ss-dash--admin">
			<div className="ss-container ss-container--wide ss-dash__grid">
				<aside className="ss-dash__side" aria-label="Admin navigation">
					<AdminSideNav user={user} />
				</aside>
				<main className="ss-dash__main">
					{(title || actions) && (
						<div className="ss-dash__head">
							<div style={{ minWidth: 0 }}>
								{title && <h1>{title}</h1>}
								{description && <p>{description}</p>}
							</div>
							{actions && <div className="ss-dash__actions">{actions}</div>}
						</div>
					)}
					{children}
				</main>
			</div>
		</div>
		<Footer />
	</>
);

export default AdminLayout;
