import React, { useState, useEffect } from "react";
import { confirmAlert } from "react-confirm-alert";
import InstructorLayout from "@/components/Instructor/InstructorLayout";
import CourseSkeletonLoader from "@/utils/CourseSkeletonLoader";
import { Button, EmptyState } from "@/components/ui";
import CoursesCard from "@/components/Instructor/CoursesCard";
import axios from "axios";
import { parseCookies } from "nookies";
import baseUrl from "@/utils/baseUrl";
import toast from "react-hot-toast";

const Index = ({ user }) => {
	const { edmy_users_token } = parseCookies();
	const [courses, setCourses] = useState([]);
	const [loading, setLoading] = useState(true);

	const fetchCourses = async () => {
		const payload = {
			headers: { Authorization: edmy_users_token },
		};

		try {
			const response = await axios.get(`${baseUrl}/api/courses`, payload);
			setCourses(response.data.courses);
		} finally {
			setLoading(false);
		}
	};
	useEffect(() => {
		fetchCourses();
	}, []);

	const confirmDelete = (courseId) => {
		confirmAlert({
			title: "Confirm to delete",
			message: "Are you sure to delete this?",
			buttons: [
				{
					label: "Yes",
					onClick: () => handleDelete(courseId),
				},
				{
					label: "No",
				},
			],
		});
	};

	const handleDelete = async (courseId) => {
		try {
			setLoading(true);
			const payload = {
				headers: { Authorization: edmy_users_token },
			};

			const url = `${baseUrl}/api/courses/course/${courseId}`;

			const response = await axios.delete(url, payload);
			setLoading(false);
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
			fetchCourses();
		} catch (err) {
			// console.log(err);
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
		<InstructorLayout
			user={user}
			title="My courses"
			description="Create, edit and manage your courses, videos and assets."
			actions={
				<Button href="/instructor/course/create/" icon="ri-add-line">
					Create course
				</Button>
			}
		>
			{loading ? (
				<CourseSkeletonLoader count={3} />
			) : courses.length > 0 ? (
				<div className="ss-grid ss-grid--cards">
					{courses.map((course) => (
						<CoursesCard key={course.id} {...course} onDelete={() => confirmDelete(course.id)} />
					))}
				</div>
			) : (
				<EmptyState
					icon="ri-book-2-line"
					title="You haven't created a course yet"
					description="Start with the basics — title, price and description. You can add videos and assets afterwards."
					action={<Button href="/instructor/course/create/">Create your first course</Button>}
				/>
			)}
		</InstructorLayout>
	);
};

export default Index;
