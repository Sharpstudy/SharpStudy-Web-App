import React, { useState } from "react";
import axios from "axios";
import Link from "next/link";
import toast from "react-hot-toast";
import LoadingSpinner from "@/utils/LoadingSpinner";
import baseUrl from "@/utils/baseUrl";
import Button from "../../utils/Button";

const INITIAL_STATE = {
	name: "",
	email: "",
	phone: "",
	subject: "",
	message: "",
};

const ContactForm = () => {
	const [contact, setContact] = useState(INITIAL_STATE);
	const [disabled, setDisabled] = React.useState(true);
	const [loading, setLoading] = React.useState(false);

	React.useEffect(() => {
		const isContact = Object.values(contact).every((el) => Boolean(el));
		isContact ? setDisabled(false) : setDisabled(true);
	}, [contact]);

	const handleChange = (e) => {
		const { name, value } = e.target;
		setContact((prevState) => ({ ...prevState, [name]: value }));
	};

	const handleSubmit = async (e) => {
		e.preventDefault();
		try {
			setLoading(true);
			const url = `${baseUrl}/api/contact`;
			const payload = { ...contact };
			const response = await axios.post(url, payload);
			toast.success(response.data.message, {
				style: {
					border: "1px solid #4BB543",
					padding: "16px",
					color: "#4BB543",
				},
				iconTheme: {
					primary: "#4BB543",
					secondary: "#FFFAEE",
				},
			});
			setContact(INITIAL_STATE);
		} catch (err) {
			let {
				response: {
					data: { message },
				},
			} = err;
			toast.error(message, {
				style: {
					border: "1px solid #ff0033",
					padding: "16px",
					color: "#ff0033",
				},
				iconTheme: {
					primary: "#ff0033",
					secondary: "#FFFAEE",
				},
			});
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="contact-area">
			<div>
				<h2 className="ss-contact__title">Send us a message</h2>

				<div className="contact-form">
					<form id="contactForm" onSubmit={handleSubmit}>
						<div className="row">
							<div className="col-lg-6 col-md-6">
								<div className="form-group">
									<input
										type="text"
										className="form-control"
										placeholder="Your Full Name"
										aria-label="Your Full Name"
										name="name"
										value={contact.name}
										onChange={handleChange}
									/>
								</div>
							</div>

							<div className="col-lg-6 col-md-6">
								<div className="form-group">
									<input
										type="email"
										className="form-control"
										placeholder="Your Email"
										aria-label="Your Email"
										name="email"
										value={contact.email}
										onChange={handleChange}
									/>
								</div>
							</div>

							<div className="col-lg-6 col-md-6">
								<div className="form-group">
									<input
										type="text"
										className="form-control"
										placeholder="Your Phone"
										aria-label="Your Phone"
										name="phone"
										value={contact.phone}
										onChange={handleChange}
									/>
								</div>
							</div>

							<div className="col-lg-6 col-md-6">
								<div className="form-group">
									<input
										type="text"
										className="form-control"
										name="subject"
										value={contact.subject}
										onChange={handleChange}
										placeholder="Your Subject"
										aria-label="Your Subject"
									/>
								</div>
							</div>

							<div className="col-lg-12">
								<div className="form-group">
									<textarea
										placeholder="Message"
										aria-label="Message"
										className="form-control"
										name="message"
										rows="5"
										value={contact.message}
										onChange={handleChange}
									/>
								</div>
							</div>

							<div className="col-12">
								<div className="form-check">
									<div className="form-group">
										<div className="form-check">
											<input
												id="contact-agree"
												name="check"
												value="I agree to the terms and privacy policy."
												className="form-check-input"
												type="checkbox"
											/>

											<label className="form-check-label" htmlFor="contact-agree">
												I agree to the{" "}
												<Link href="/terms-conditions">
													<a>
														Terms &amp; conditions
													</a>
												</Link>
											</label>
											<div className="help-block with-errors gridCheck-error"></div>
										</div>
									</div>
								</div>
							</div>

							<div className="col-lg-12 col-md-12 text-center">
								<Button
									loading={loading}
									disabled={disabled}
									btnText="Send Message"
									btnClass="default-btn active"
								/>

								<div className="clearfix"></div>
							</div>
						</div>
					</form>
				</div>
			</div>

			<img
				src="/images/contact-shape-1.svg"
				className="shape shape-1"
				alt="contact"
			/>
			<img
				src="/images/contact-shape-2.svg"
				className="shape shape-2"
				alt="contact"
			/>
		</div>
	);
};

export default ContactForm;
