import React, { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import InstructorLayout from "@/components/Instructor/InstructorLayout";
import { Button, EmptyState, StatTile } from "@/components/ui";

const fmt = (d) => (d ? new Date(d).toLocaleDateString(undefined, { dateStyle: "medium" }) : "");

// Everything on this page comes from /api/instructor/dashboard (the caller's own courses only).
const Dashboard = ({ user }) => {
	const [data, setData] = useState(null);
	const [error, setError] = useState("");
	useEffect(() => {
		axios.get("/api/instructor/dashboard").then((r) => setData(r.data)).catch((e) => setError((e.response && e.response.data && e.response.data.message) || "Could not load the dashboard."));
	}, []);
	const t = data && data.totals;
	return (
		<InstructorLayout user={user} title="Instructor dashboard" description="How your courses and students are doing." actions={<Button href="/instructor/course/create/" icon="ri-add-line">Create course</Button>}>
			{error && <div className="ss-alert ss-alert--danger" role="alert">{error}</div>}
			{!data && !error && <p className="ss-muted" role="status">Loading…</p>}
			{t && (
				<>
					<div className="ss-grid ss-grid--4">
						<StatTile icon="ri-book-2-line" tone="accent" value={t.courses} label="Total courses" />
						<StatTile icon="ri-eye-line" tone="success" value={t.published} label="Published" />
						<StatTile icon="ri-draft-line" tone="accent" value={t.drafts} label="Draft / awaiting approval" />
						<StatTile icon="ri-group-line" tone="success" value={t.students} label="Enrolled students" />
					</div>
					<p className="ss-muted ia-note">Students have completed {t.lessonsCompleted} lesson{t.lessonsCompleted === 1 ? "" : "s"} across your {t.lessons} lesson video{t.lessons === 1 ? "" : "s"}. A course is published once an admin approves it.</p>
					<div className="ia-cols">
						<section aria-labelledby="re">
							<h2 className="ss-subhead" id="re">Recent enrolments</h2>
							{data.recentEnrolments.length === 0 ? (
								<EmptyState icon="ri-user-add-line" title="No enrolments yet" description="New students appear here." />
							) : (
								<ul className="ia-list">{data.recentEnrolments.map((e) => <li key={e.id}><strong>{e.student}</strong><span className="ss-muted">{e.course} · {fmt(e.at)}</span></li>)}</ul>
							)}
							<Link href="/instructor/students/"><a>All students</a></Link>
						</section>
						<section aria-labelledby="rc">
							<h2 className="ss-subhead" id="rc">Recent course activity</h2>
							{data.recentCourses.length === 0 ? (
								<EmptyState icon="ri-book-2-line" title="No courses yet" description="Create your first course to get started." action={<Button href="/instructor/course/create/">Create course</Button>} />
							) : (
								<ul className="ia-list">{data.recentCourses.map((c) => <li key={c.id}><strong>{c.title}</strong><span className="ss-muted">{c.published ? "Published" : "Not published"} · updated {fmt(c.updatedAt)}</span></li>)}</ul>
							)}
							<Link href="/instructor/courses/"><a>All courses</a></Link>
						</section>
					</div>
				</>
			)}
		</InstructorLayout>
	);
};

export default Dashboard;
