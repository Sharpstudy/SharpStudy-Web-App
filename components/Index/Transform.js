import React from "react";
import Link from "next/link";

const Transform = () => {
	return (
		<div className="transform-area pb-100">
			<div className="container">
				<div className="row align-items-center">
					<div className="col-lg-6 wow animate__animated animate__fadeInLeft delay-0-2s">
						<div className="transform-conetnt wow animate__animated animate__fadeInLeft delay-0-8s">
							<h2>
								Creating Leaders and Visionaries of Tomorrow
							</h2>
							<p>
							Sharpstudy makes Youth into  World class Tech & Business Leaders by Project based learning / Interning and  Problem solving where they team up learn and apply the Tech , Communication, Presentation , and creating businesses in real time  using advance and practical learning methods
							</p>

							{/* <div className="single-transform d-flex align-items-center">
								<div className="transform-video-img flex-shrink-0">
									<img
										src="/images/courses/course-16.jpg"
										alt="about"
									/>
									<Link href="/learning/my-courses">
										<a className="video-btns popup-youtube">
											<i className="ri-play-circle-fill"></i>
										</a>
									</Link>
								</div>

								<div className="transform-video-content flex-grow-1">
									<h3>
										<Link href="/learning/my-courses">
											<a className="popup-youtube">
												Watch Video From the Community
												How Sharpstudy Change Their Life
											</a>
										</Link>
									</h3>
									<ul>
										<li>My Courses</li>
									</ul>
								</div>
							</div> */}

							<Link href="/courses">
								<a className="default-btn">Find Out How</a>
							</Link>
						</div>
					</div>

					<div className="col-lg-6 wow animate__animated animate__fadeInRight delay-0-2s">
						<div className="transform-img wow animate__animated animate__fadeInRight delay-0-8s">
							<img
								src="/images/transform-img.png"
								alt="transform"
							/>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};

export default Transform;
