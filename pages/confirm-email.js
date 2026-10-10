import React, { useState } from "react";
import axios from "axios";
import Router, { useRouter } from "next/router";
import baseUrl from "@/utils/baseUrl";
import Navbar from "@/components/_App/Navbar";
import { Button } from "@/components/ui";

const ConfirmEmailPage = () => {
	const router = useRouter();
	const [status, setStatus] = useState("pending"); // pending | done | error

	React.useEffect(() => {
		// Wait for the query string; the original ran once with an empty query.
		if (!router.isReady) return;
		const confirmEmail = async () => {
			try {
				const { token, email } = router.query;
				const url = `${baseUrl}/api/users/confirm-email`;
				const payload = { token, email };
				await axios.put(url, payload);
				setStatus("done");
				setTimeout(() => {
					Router.reload("/");
				}, 2000);
				Router.push("/");
			} catch (error) {
				console.log(error);
				setStatus("error");
			}
		};

		confirmEmail();
	}, [router.isReady, router.query]);

	return (
		<>
			<Navbar />
			<main className="ss-auth">
				<div className="ss-container">
					<section className="ss-card ss-status-card" aria-live="polite">
						{status === "pending" && (
							<>
								<span className="ss-spinner ss-spinner--lg" aria-hidden="true"></span>
								<h1>Confirming your email…</h1>
								<p className="ss-muted">This only takes a moment.</p>
							</>
						)}
						{status === "done" && (
							<>
								<span className="ss-icon-tile ss-icon-tile--lg ss-icon-tile--success" aria-hidden="true">
									<i className="ri-checkbox-circle-line"></i>
								</span>
								<h1>Email confirmed</h1>
								<p className="ss-muted">Taking you to SharpStudy…</p>
							</>
						)}
						{status === "error" && (
							<>
								<span className="ss-icon-tile ss-icon-tile--lg ss-icon-tile--accent" aria-hidden="true">
									<i className="ri-error-warning-line"></i>
								</span>
								<h1>We couldn&apos;t confirm your email</h1>
								<p className="ss-muted">
									The link may have expired or already been used. Try logging in, or
									contact support if the problem continues.
								</p>
								<div className="d-flex flex-wrap gap-2 justify-content-center">
									<Button href="/auth">Go to log in</Button>
									<Button href="/contact-us/" variant="secondary">
										Contact support
									</Button>
								</div>
							</>
						)}
					</section>
				</div>
			</main>
		</>
	);
};

export default ConfirmEmailPage;
