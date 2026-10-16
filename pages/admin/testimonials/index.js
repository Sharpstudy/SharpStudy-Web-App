import React, { useState, useEffect } from "react";
import AdminLayout from "@/components/_App/AdminLayout";
import Link from "next/link";
import toast from "react-hot-toast";
import axios from "axios";
import baseUrl from "@/utils/baseUrl";
import TestimonialRow from "@/components/Admin/TestimonialRow";
import { parseCookies } from "nookies";
import GeneralLoader from "@/utils/GeneralLoader";

const Index = ({ user }) => {
	const { edmy_users_token } = parseCookies();
	const [testimonials, setTestimonials] = useState([]);
	const [loading, setLoading] = useState(true);

	const fetchData = async () => {
		setLoading(true);
		try {
			const payload = {
				headers: { Authorization: edmy_users_token },
			};
			const response = await axios.get(
				`${baseUrl}/api/testimonials`,
				payload
			);
			setTestimonials(response.data.testimonials);
			setLoading(false);
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

	useEffect(() => {
		fetchData();
	}, []);

	const handleDelete = async (testId) => {
		try {
			const payload = {
				headers: { Authorization: edmy_users_token },
				params: { testId },
			};
			const response = await axios.delete(
				`${baseUrl}/api/testimonials/create`,
				payload
			);
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
			fetchData();
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
			fetchData();
		}
	};

	return (
		<>

			<AdminLayout user={user} title="Testimonials" description="Quotes shown on the homepage.">
								{/* Nav */}
								<ul className="nav-style1">
									<li>
										<Link href="/admin/testimonials/">
											<a className="active">
												Testimonials
											</a>
										</Link>
									</li>
									<li>
										<Link href="/admin/testimonials/create/">
											<a>Create</a>
										</Link>
									</li>
								</ul>

								{loading ? (
									<GeneralLoader />
								) : (
									<div className="table-responsive">
										<table className="table table-hover align-middle fs-14">
											<thead>
												<tr>
													<th scope="col">Image</th>
													<th scope="col">Name</th>
													<th scope="col">
														Designation
													</th>
													<th scope="col">Text</th>
													<th scope="col">Action</th>
												</tr>
											</thead>
											<tbody>
												{testimonials.length > 0 ? (
													testimonials.map((test) => (
														<TestimonialRow
															{...test}
															key={test.id}
															onDelete={() =>
																handleDelete(
																	test.id
																)
															}
														/>
													))
												) : (
													<tr>
														<td
															colSpan="6"
															className="text-center py-4 ss-muted"
														>
															Nothing here yet.
														</td>
													</tr>
												)}
											</tbody>
										</table>
									</div>
								)}
			</AdminLayout>
		</>
	);
};

export default Index;
