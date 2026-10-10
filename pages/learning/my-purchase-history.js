import React, { useEffect, useState } from "react";
import Link from "next/link";
import { parseCookies } from "nookies";
import baseUrl from "@/utils/baseUrl";
import axios from "axios";
import { formatDate } from "@/utils/helper";
import StudentLayout from "@/components/Learning/StudentLayout";
import GeneralLoader from "@/utils/GeneralLoader";
import { Button, EmptyState } from "@/components/ui";

function MyPurchases({ user }) {
	const { edmy_users_token } = parseCookies();

	const [enrolments, setEnrolments] = useState([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const fetchEnrol = async () => {
			try {
				const payload = { headers: { Authorization: edmy_users_token } };
				const url = `${baseUrl}/api/learnings/my-purchases`;
				const response = await axios.get(url, payload);
				setEnrolments(response.data.enrolments);
			} finally {
				setLoading(false);
			}
		};
		fetchEnrol();
	}, []);
	if (loading) {
		return (
			<StudentLayout user={user} section="learning" title="Purchase history" description="Every course you've bought, with price and date.">
				<GeneralLoader />
			</StudentLayout>
		);
	}

	return (
		<StudentLayout user={user} section="learning" title="Purchase history" description="Every course you've bought, with price and date.">
			{enrolments.length > 0 ? (
				<ul className="ss-purchases">
					{enrolments.map((enrol) => (
						<li key={enrol.id} className="ss-card ss-purchase">
							<Link href={`/learning/course/${enrol.course.slug}`}>
								<a className="ss-purchase__img" tabIndex={-1} aria-hidden="true">
									{/* eslint-disable-next-line @next/next/no-img-element */}
									<img src={enrol.course.image} alt="" loading="lazy" />
								</a>
							</Link>
							<div className="ss-purchase__body">
								<h3>
									<Link href={`/learning/course/${enrol.course.slug}`}>
										<a>{enrol.course.title}</a>
									</Link>
								</h3>
								<p className="ss-muted">
									By {enrol.course.user.first_name} {enrol.course.user.last_name}
								</p>
								<ul className="ss-purchase__facts">
									{enrol.course.duration && (
										<li><i className="ri-time-line" aria-hidden="true"></i>{enrol.course.duration}</li>
									)}
									{enrol.course.lessons > 0 && (
										<li><i className="ri-play-list-2-line" aria-hidden="true"></i>{enrol.course.lessons} lessons</li>
									)}
									{enrol.course.access_time && (
										<li><i className="ri-key-2-line" aria-hidden="true"></i>{enrol.course.access_time}</li>
									)}
								</ul>
							</div>
							<dl className="ss-purchase__meta">
								<div>
									<dt>Paid</dt>
									<dd>${enrol.bought_price}</dd>
								</div>
								<div>
									<dt>Date</dt>
									<dd>{formatDate(enrol.created_at)}</dd>
								</div>
							</dl>
						</li>
					))}
				</ul>
			) : (
				<EmptyState
					icon="ri-bank-card-line"
					title="No purchases yet"
					description="When you buy a course, your receipt details will be listed here."
					action={<Button href="/courses/">Browse courses</Button>}
				/>
			)}
		</StudentLayout>
	);
}

export default MyPurchases;
