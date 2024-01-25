import Link from "next/link";
import React from "react";
import SearchForm from "@/components/_App/SearchForm";
import AnimatedCharacters from "./BannerText";
import { motion } from "framer-motion";
import { useRouter } from "next/router";


const Banner = () => {
	const router = useRouter();
	const headingText = [
		{
			type: "heading",
			text: "Learn more about our transformational Workshops in The Age Of AI.",
		},
	];

	const variants = {
		visible: {
			transition: {
				staggerChildren: 0.025,
			},
		},
	};

	const pVariants = {
		hidden: {
			scale: 0.8,
			opacity: 0,
		},
		visible: {
			scale: 1,
			opacity: 1,
			transition: {
				delay: 1.9,
			},
		},
	};

	return (
		<div className="banner-area bg-1">
			<div className="container-fluid">
				<div className="row align-items-center">
					<div className="col-lg-6">
						<div className="banner-imhtml.netlify.appg">
							<motion.img
								initial={{ scale: 0 }}
								animate={{ scale: 1 }}
								src="/images/workshops.png"
								alt="banner"
							/>
						</div>
					</div>

					<div className="col-lg-6">
						<motion.div
							initial="hidden"
							animate="visible"
							variants={variants}
							className="banner-content"
						>
							{headingText.map((item, index) => {
								return (
									<AnimatedCharacters {...item} key={index} />
								);
							})}
							<motion.p
								initial="hidden"
								animate="visible"
								variants={pVariants}
							>
								Making the world future-ready by imparting critical cognitive, Technical and Business skills to the next generation of leaders.

							{/* Limitless learning <span>40k+</span> Online courses &{" "}
								<span>500K+</span> Online registered student.
								Study whenever you like. */}
							</motion.p>
							<button
								type="button"
								className="btn btn-warning btn-lg"
								onClick={() => router.push(`https://meetings.hubspot.com/mike1162 `)}
							>
								Schedule a call
							</button>


							{/* <SearchForm
								formClass="search-form"
								btnClass="default-btn"
								banner={true}
							/> */}

							{/* <ul className="client-list">
								<li>
									<img
										src="/images/banner/client-1.jpg"
										alt="banner"
									/>
									<img
										src="/images/banner/client-2.jpg"
										className="client"
										alt="banner"
									/>
									<img
										src="/images/banner/client-3.jpg"
										className="client"
										alt="banner"
									/>
								</li>
								<li>
									<p>
										500K+ People already trusted us.{" "}
										<Link href="/courses">
											<a className="read-more">
												View Courses{" "}
												<i className="ri-arrow-right-line"></i>
											</a>
										</Link>
									</p>
								</li>
							</ul> */}
						</motion.div>
					</div>
				</div>
			</div>

			<img
				src="/images/banner/shape-1.svg"
				className="shape shape-1"
				alt="banner"
			/>
			<img
				src="/images/banner/shape-2.svg"
				className="shape shape-2"
				alt="banner"
			/>
			<img
				src="/images/banner/shape-3.svg"
				className="shape shape-3"
				alt="banner"
			/>
		</div>
	);
};

export default Banner;
