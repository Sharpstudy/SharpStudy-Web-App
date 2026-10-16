import React from "react";
import Link from "next/link";
import AdminLayout from "@/components/_App/AdminLayout";
import { StatTile } from "@/components/ui";
import baseUrl from "@/utils/baseUrl";

const Index = ({
	students,
	instructors,
	courses,
	enrolments,
	earningsTotal,
	videos,
	assets,
	user,
}) => {
	return (
		<>

			<AdminLayout user={user} title="Dashboard" description="An overview of activity across SharpStudy.">
				<div className="ss-stats">
					<StatTile icon="ri-group-line" value={students} label="Total students" />
					<StatTile icon="ri-slideshow-2-line" tone="info" value={instructors} label="Total instructors" />
					<StatTile icon="ri-book-2-line" value={courses} label="Total courses" />
					<StatTile icon="ri-user-follow-line" tone="success" value={enrolments} label="Course enrolments" />
					<StatTile icon="ri-money-dollar-circle-line" tone="success" value={`$${earningsTotal}`} label="Total sales" />
					<StatTile icon="ri-video-line" tone="accent" value={videos} label="Course videos" />
					<StatTile icon="ri-folder-2-line" tone="accent" value={assets} label="Course assets" />
				</div>

				<h2 className="ss-subhead">Quick links</h2>
				<div className="ss-grid ss-grid--3">
					<Link href="/admin/courses/new-arrival/">
						<a className="ss-card ss-card--interactive ss-quicklink">
							<i className="ri-inbox-archive-line" aria-hidden="true"></i>
							<span><strong>Review new courses</strong><small>Approve submitted courses</small></span>
						</a>
					</Link>
					<Link href="/admin/instructor/requests/">
						<a className="ss-card ss-card--interactive ss-quicklink">
							<i className="ri-user-add-line" aria-hidden="true"></i>
							<span><strong>Instructor requests</strong><small>Review applications</small></span>
						</a>
					</Link>
					<Link href="/admin/coupons/create/">
						<a className="ss-card ss-card--interactive ss-quicklink">
							<i className="ri-coupon-3-line" aria-hidden="true"></i>
							<span><strong>Create a coupon</strong><small>Add a discount code</small></span>
						</a>
					</Link>
				</div>
			</AdminLayout>
		</>
	);
};

// This gets called on every request
export async function getServerSideProps({ req }) {
	// Fetch data from external API
	const res = await fetch(`${baseUrl}/api/funfacts`, { headers: { Authorization: (req.cookies && req.cookies.edmy_users_token) || "" } });
	// Non-admins get 401 here; the page itself redirects them, so render zeros.
	const data = res.ok ? await res.json() : {};
	const {
		students = 0,
		instructors = 0,
		courses = 0,
		enrolments = 0,
		earningsTotal = "0.00",
		videos = 0,
		assets = 0,
	} = data;

	// Pass data to the page via props
	return {
		props: {
			students,
			instructors,
			courses,
			enrolments,
			earningsTotal,
			videos,
			assets,
		},
	};
}

export default Index;
