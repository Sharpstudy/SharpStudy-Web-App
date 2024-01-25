import React from "react";
import Link from "next/link";
import { motion } from "framer-motion";

const Footer = () => {
	const currentYear = new Date().getFullYear();
	return (
		<>
			<div className="footer-area bg-color-f6fafb pt-100 pb-70">
				<div className="container">
					<div className="row">
						<div className="col-lg-3 col-sm-6">
							<div className="single-footer-widget">
								<a href="index.html" className="logo">
									<img
										src="/images/sharpstudy.png"
										className="main-logo"
										alt="Sharp Study Logo"
									/>
									<img
										src="/images/sharpstudy.png"
										className="white-logo"
										alt="logo"
									/>
								</a>
								<p>
									SharpStudy Learning Inc. is a Project based cognetive skills development which uses advanced pedogogy for practical and enhanced learning.
								</p>
							</div>
						</div>

						<div className="col-lg-3 col-sm-6">
							<div className="single-footer-widget pl-40">
								<h3>Quick Link</h3>

								<ul className="import-link">
									<motion.li
										whileHover={{
											scale: 1.1,
											originX: 0,
											transition: { duration: 0.5 },
										}}
									>
										<Link href="/courses">
											<a>Courses</a>
										</Link>
									</motion.li>
									<motion.li
										whileHover={{
											scale: 1.1,
											originX: 0,
											transition: { duration: 0.5 },
										}}
									>
										<Link href="/about-us">
											<a>About Us</a>
										</Link>
									</motion.li>
									<motion.li
										whileHover={{
											scale: 1.1,
											originX: 0,
											transition: { duration: 0.5 },
										}}
									>
										<Link href="/terms-conditions">
											<a>Terms & Conditions</a>
										</Link>
									</motion.li>
								</ul>
							</div>
						</div>

						<div className="col-lg-3 col-sm-6">
							<div className="single-footer-widget pl-40">
								<h3>Help Center</h3>

								<ul className="import-link">
									<motion.li
										whileHover={{
											scale: 1.1,
											originX: 0,
											transition: { duration: 0.5 },
										}}
									>
										<Link href="/contact-us">
											<a>Support</a>
										</Link>
									</motion.li>
									<motion.li
										whileHover={{
											scale: 1.1,
											originX: 0,
											transition: { duration: 0.5 },
										}}
									>
										<Link href="/faq">
											<a>Get Help</a>
										</Link>
									</motion.li>
									<motion.li
										whileHover={{
											scale: 1.1,
											originX: 0,
											transition: { duration: 0.5 },
										}}
									>
										<Link href="/privacy-policy">
											<a>Privacy Policy</a>
										</Link>
									</motion.li>
								</ul>
							</div>
						</div>

						<div className="col-lg-3 col-sm-6">
							<div className="single-footer-widget">
								<h3>Contact Info</h3>

								<ul className="info">
									<li>
										<span>Call Us:</span>{" "}
										<a href="tel:16047670944">
											1-604-767-0944
										</a>
									</li>
									<li>
										<span>Address:</span> 151 West Hasting St,
										Vancouver , B.C.  V3c 4L8 Canada
									</li>
									<li>
										<span>Mail Us:</span>{" "}
										<a href="mailto:mike@evolvelab.co">
											mike@evolvelab.co
										</a>
									</li>
								</ul>
							</div>
						</div>
					</div>
				</div>

				<img
					src="/images/footer-shape-1.png"
					className="shape shape-1"
					alt="footer"
				/>
				<img
					src="/images/footer-shape-2.png"
					className="shape shape-2"
					alt="footer"
				/>
			</div>

			<div className="copy-right-area bg-color-f6fafb">
				<div className="container">
					<p>
						&copy; Sharpstudy {currentYear} is Proudly Owned by{" "}
						<a href="https://www.hypervers.co/" target="_blank">
							Hypervers Solutions Inc.
						</a>
					</p>
				</div>
			</div>
		</>
	);
};

export default Footer;
