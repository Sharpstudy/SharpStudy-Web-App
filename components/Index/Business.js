import React from "react";
import Link from "next/link";

function Business() {
	return (
		<div className="business-area pb-100">
			<div className="container">
				<div className="business-bg rounded bg-color-f2f0ef ptb-100">
					<div className="row align-items-center">
						<div className="col-lg-7">
							<div className="business-img">
								<img
									src="/images/business-img.png"
									alt="business"
								/>
							</div>
						</div>

						<div className="col-lg-5">
							<div className="business-content">
								<h2>
								Empower and upskill your employees with our corporate training workshops
									
								</h2>
								<p>
								Elevate your team's performance with our dynamic corporate training workshops. Tailored to enhance skills and boost confidence, our program equips employees to tackle modern technical and business challenges efficiently. 
								</p>

								<Link href="/become-an-instructor">
									<a className="default-btn">
										Get Sharpstudy Business
									</a>
								</Link>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

export default Business;
