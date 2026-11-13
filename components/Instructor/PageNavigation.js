import React, { useState, useEffect } from "react";
import Link from "next/link";
import axios from "axios";
import { parseCookies } from "nookies";
import baseUrl from "@/utils/baseUrl";

const PageNavigation = ({ courseId, activeClassname }) => {
	const { edmy_users_token } = parseCookies();
	const [course, setCourse] = useState({ title: "" });

	useEffect(() => {
		const fetchCourse = async () => {
			const payload = {
				headers: { Authorization: edmy_users_token },
			};
			const url = `${baseUrl}/api/courses/course/${courseId}`;
			const response = await axios.get(url, payload);
			setCourse({ title: response.data.course.title });
		};

		fetchCourse();
	}, []);

	const tabs = [
		{ key: "edit", href: `/instructor/course/edit/${courseId}`, label: "Course details", icon: "ri-edit-line" },
		{ key: "upload", href: `/instructor/course/upload/${courseId}`, label: "Upload video", icon: "ri-upload-cloud-2-line" },
		{ key: "uploads", href: `/instructor/course/uploads/${courseId}`, label: "Videos", icon: "ri-video-line" },
		{ key: "assets", href: `/instructor/course/assets/${courseId}`, label: "Assets", icon: "ri-folder-2-line" },
	];

	return (
		<>
			<div className="ss-dash__head">
				<div style={{ minWidth: 0 }}>
					<Link href="/instructor/courses/">
						<a className="ss-backlink">
							<i className="ri-arrow-left-line" aria-hidden="true"></i> My courses
						</a>
					</Link>
					<h1>{(course && course.title) || "Course"}</h1>
				</div>
			</div>

			<nav className="ss-tabs" aria-label="Course sections">
				{tabs.map((t) => (
					<Link href={t.href} key={t.key}>
						<a
							className={activeClassname == t.key ? "active" : ""}
							aria-current={activeClassname == t.key ? "page" : undefined}
						>
							<i className={t.icon} aria-hidden="true"></i>
							{t.label}
						</a>
					</Link>
				))}
			</nav>
		</>
	);
};

export default PageNavigation;
