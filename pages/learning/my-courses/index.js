import React, { useEffect, useState } from "react";
import axios from "axios";
import { parseCookies } from "nookies";
import baseUrl from "@/utils/baseUrl";
import CourseCard from "@/components/Learning/CourseCard";
import StudentLayout from "@/components/Learning/StudentLayout";
import CourseSkeletonLoader from "@/utils/CourseSkeletonLoader";
import { Button, EmptyState } from "@/components/ui";

const Index = ({ user }) => {
	const { edmy_users_token } = parseCookies();
	const [enrolments, setEnrolments] = useState([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const fetchEnrols = async () => {
			setLoading(true);
			try {
				const payload = {
					headers: { Authorization: edmy_users_token },
				};
				const response = await axios.get(
					`${baseUrl}/api/learnings`,
					payload
				);

				setEnrolments(response.data.enrolments);
			} finally {
				setLoading(false);
			}
		};

		fetchEnrols();
	}, []);

	return (
		<StudentLayout user={user} section="learning">
			{loading ? (
				<CourseSkeletonLoader count={3} />
			) : enrolments && enrolments.length > 0 ? (
				<div className="ss-grid ss-grid--cards">
					{enrolments.map((enrol) => (
						<CourseCard key={enrol.id} {...enrol} />
					))}
				</div>
			) : (
				<EmptyState
					icon="ri-book-read-line"
					title="You haven't enrolled in a course yet"
					description="Courses you enrol in will appear here so you can jump straight back in."
					action={<Button href="/courses/">Browse courses</Button>}
				/>
			)}
		</StudentLayout>
	);
};

export default Index;
