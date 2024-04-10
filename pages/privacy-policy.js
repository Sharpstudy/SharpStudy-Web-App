import React from "react";
import PageBanner from "@/components/Common/PageBanner";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";

const privacyPolicy = ({ user }) => {
	return (
		<>
			<Navbar user={user} />
			<PageBanner
				pageTitle="Privacy Policy"
				homePageUrl="/"
				homePageText="Home"
				activePageText="Privacy Policy"
			/>

			<section className="ptb-100">
				<div className="container">
					<div className="main-content-text">
						

						<div className="gap-20"></div>
						<h3>Information We Collect:</h3>
						<p> <strong>Personal Information:</strong>  We may collect personal information such as names, email addresses, and other contact details when users register for an account, subscribe to our newsletter, or engage in other activities on our Site.
						</p>
						<p>
						<strong>Usage Information:</strong>	  We automatically collect certain information about how users interact with our Site, including IP addresses, browser types, operating systems, and pages viewed. This information helps us improve the user experience and optimize our services.
						Cookies and Similar Technologies: We use cookies and similar technologies to track user preferences, enhance user experience, and collect analytics data. Users can manage cookie preferences through their browser settings.
						</p>

						<h3>How We Use Information:</h3>
						<p>
						Personal Information: We may collect personal information such as names, email addresses, and other contact details when users register for an account, subscribe to our newsletter, or engage in other activities on our Site.</p>
						<p><strong>Usage Information:</strong> We automatically collect certain information about how users interact with our Site, including IP addresses, browser types, operating systems, and pages viewed. This information helps us improve the user experience and optimize our services.
						Cookies and Similar Technologies: We use cookies and similar technologies to track user preferences, enhance user experience, and collect analytics data. Users can manage cookie preferences through their browser settings.
						</p>
						How We Use Information:

						Provide Services: We use personal information to deliver the services requested by users, such as providing access to educational resources and facilitating communication.
						Communication: We may use contact information to send users updates, newsletters, promotional offers, and other communications related to our services. Users can opt-out of receiving marketing communications at any time.
						Analytics: We analyze usage data to understand how users interact with our Site and improve its functionality and content.

						
						<p>
							Lorem ipsum dolor sit amet consectetur, adipisicing
							elit. Ut, placeat? Culpa ab est nemo perspiciatis
							quam, nesciunt reprehenderit voluptate id error
							corrupti doloremque exercitationem quis, iusto
							debitis velit eveniet ea. ipsum dolor sit amet
							consectetur, adipisicing elit. Ut, placeat? Culpa ab
							est nemo perspiciatis quam, nesciunt reprehenderit
						</p>

						<div className="gap-20"></div>

						<h3>
							3. Using and disclosing your personal information:
						</h3>
						<p>
							Curabitur arcu erat, accumsan id imperdiet et,
							porttitor at sem. Vivamus suscipit tortor eget felis
							porttitor volutpat. Nulla quis lorem ut libero
							malesuada feugiat. Nulla porttitor accumsan
							tincidunt. Sed porttitor lectus nibh. Pellentesque
							in ipsum id orci porta dapibus.Nulla quis lorem ut
							libero malesuada feugiat. Proin eget tortor risus.
							Nulla porttitor accumsan tinci dunt. Donec rutrum
							congue leo eget malesuada. Vestibulum ac diam sit
							amet quam vehicula elementum sed sit amet dui.
							Vivamus magna justo.
						</p>
						<p>
							Quisque velit nisi, pretium ut lacinia in, elementum
							id enim. Proin eget tortor risus. Lorem ipsum dolor
							sit amet, consectetur adipiscing elit. Curabitur
							aliquet quam id dui posuere blandit. Vivamus magna
							justo, lacinia eget consectetur sed, convallis at
							tellus. Praesent sapien massa, convallis a
							pellentesque nec, egestas non nisi.
						</p>

						<div className="gap-20"></div>

						<h3>4. Contact by the company:</h3>
						<p>
							Nulla quis lorem ut libero malesuada feugiat. Proin
							eget tortor risus. Nulla porttitor accumsan
							tincidunt. Donec rutrum congue leo eget malesuada.
							Vestibulum ac diam sit amet quam vehicula elementum
							sed sit amet dui. Vivamus magna justo, lacinia eget
							consectetur sed, convallis at tellus libero
							malesuada feugiat. Proin eget tortor.
						</p>
						<ul>
							<li>
								<i className="ri-check-line"></i>
								Quisque velit nisi, pretium ut lacinia in,
								elementum id enim.
							</li>
							<li>
								<i className="ri-check-line"></i>
								Proin eget tortor risus consectetur adipiscing
								elit.
							</li>
							<li>
								<i className="ri-check-line"></i>
								Curabitur aliquet quam id dui posuere blandit.
							</li>
						</ul>

						<div className="gap-20"></div>

						<h3>5. Individual’s right of access:</h3>
						<p>
							Curabitur arcu erat, accumsan id imperdiet et,
							porttitor at sem. Vivamus suscipit tortor eget felis
							porttitor volutpat. Nulla quis lorem ut libero
							malesuada feugiat. Nulla porttitor accumsan
							tincidunt. Sed porttitor lectus nibh. Pellentesque
							in ipsum id orci porta dapibus.Nulla quis lorem ut
							libero malesuada feugiat. Proin eget tortor risus.
							Nulla porttitor accumsan tinci dunt. Donec rutrum
							congue leo eget malesuada. Vestibulum ac diam sit
							amet quam vehicula elementum sed sit amet dui.
							Vivamus magna justo
						</p>
						<p>
							Quisque velit nisi, pretium ut lacinia in, elementum
							id enim. Proin eget tortor risus. Lorem ipsum dolor
							sit amet, consectetur adipiscing elit. Curabitur
							aliquet quam id dui posuere blandit. Vivamus magna
							justo, lacinia eget consectetur sed, convallis at
							tellus. Praesent sapien massa, convallis a
							pellentesque nec, egestas non nisi.
						</p>

						<div className="gap-20"></div>

						<h3>6. The company and links to other web sites:</h3>
						<p>
							Proin eget tortor risus. Mauris blandit aliquet
							elit, eget tincidunt nibh pulvinar a. Quisque velit
							nisi, pretium ut lacinia in elementum id enim.
							Praesent sapien massa, convallis a pellentesque nec,
							egestas non nisi. Cras ultricies ligula sed magna
							dictum porta. Curabitur non nulla sit amet nisl
							tempus convallis quis ac lectus. Vestibulum ac diam
							sit amet quam vehicula elementum sed sit amet dui.
							Donec rutrum congue leo eget malesuada. Donec rutrum
							congue leo eget malesuada. Pellentesque in ipsum id
							orci.
						</p>
					</div>
				</div>
			</section>

			<Footer />
		</>
	);
};

export default privacyPolicy;
