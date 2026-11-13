import React, { useState, useEffect } from "react";
import { parseCookies } from "nookies";
import baseUrl from "@/utils/baseUrl";
import axios from "axios";
import CoursesList from "@/components/Courses/CoursesList";
import StudentLayout from "@/components/Learning/StudentLayout";
import CourseSkeletonLoader from "@/utils/CourseSkeletonLoader";
import { Button, EmptyState } from "@/components/ui";

const Index = ({ user }) => {
	const { edmy_users_token } = parseCookies();

	const [courses, setCourses] = useState([]);
	const [loading, setLoading] = useState(true);

	const fetchEnrol = async () => {
		try {
			const payload = { headers: { Authorization: edmy_users_token } };
			const url = `${baseUrl}/api/wishlist`;
			const response = await axios.get(url, payload);
			let courseArray = [];
			if (response) {
				response.data.courses.map((c) => {
					courseArray.push(c.course);
				});
			}
			setCourses(courseArray);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchEnrol();
	}, []);

	return (
		<StudentLayout user={user} section="learning">
			{loading ? (
				<CourseSkeletonLoader count={3} />
			) : (
				<CoursesList
					courses={courses}
					user={user}
					empty={
						<EmptyState
							icon="ri-heart-3-line"
							title="Your wishlist is empty"
							description="Tap the heart on any course to save it here for later."
							action={<Button href="/courses/">Explore courses</Button>}
						/>
					}
				/>
			)}
		</StudentLayout>
	);
};

export default Index;
