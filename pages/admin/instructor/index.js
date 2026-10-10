import React, { useState, useEffect } from "react";
import AdminLayout from "@/components/_App/AdminLayout";
import Link from "next/link";
import toast from "react-hot-toast";
import axios from "axios";
import baseUrl from "@/utils/baseUrl";
import { parseCookies } from "nookies";
import GeneralLoader from "@/utils/GeneralLoader";
import InstructorRow from "@/components/Admin/InstructorRow";

const Index = ({ user }) => {
	const { edmy_users_token } = parseCookies();
	const [instructors, setInstructors] = useState([]);
	const [loading, setLoading] = useState(true);

	const fetchData = async () => {
		setLoading(true);
		try {
			const payload = {
				headers: { Authorization: edmy_users_token },
			};
			const response = await axios.get(
				`${baseUrl}/api/instructor/instructors`,
				payload
			);
			setInstructors(response.data.instructors);
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

	return (
		<>

			<AdminLayout user={user} title="Instructors" description="Everyone who teaches on SharpStudy.">
								<ul className="nav-style1">
									<li>
										<Link href="/admin/instructor/">
											<a className="active">
												Instructors
											</a>
										</Link>
									</li>
									<li>
										<Link href="/admin/instructor/requests/">
											<a>Requests</a>
										</Link>
									</li>
								</ul>
								{loading ? (
									<GeneralLoader />
								) : (
									<div className="table-responsive">
										<table className="table align-middle table-hover fs-14">
											<thead>
												<tr>
													<th scope="col">Name</th>
													<th scope="col">Email</th>
													<th scope="col">Phone</th>
													<th scope="col">Subject</th>
													<th scope="col">Text</th>
													<th scope="col">Status</th>
												</tr>
											</thead>
											<tbody>
												{instructors.length > 0 ? (
													instructors.map(
														(instructor) => (
															<InstructorRow
																key={
																	instructor.id
																}
																{...instructor}
															/>
														)
													)
												) : (
													<tr>
														<td
															colSpan="7"
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
