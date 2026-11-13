import React, { useEffect, useState } from "react";
import InstructorLayout from "@/components/Instructor/InstructorLayout";
import CourseUpdateForm from "@/components/Instructor/CourseUpdateForm";
import { useRouter } from "next/router";
import axios from "axios";
import { parseCookies } from "nookies";
import baseUrl from "@/utils/baseUrl";
import PageNavigation from "../../../../components/Instructor/PageNavigation";

const Create = ({ user }) => {
	const { edmy_users_token } = parseCookies();
	const router = useRouter();
	const { id: courseId } = router.query;
	const [course, setCourse] = useState({});

	useEffect(() => {
		const fetchCourse = async () => {
			const payload = {
				headers: { Authorization: edmy_users_token },
			};
			const url = `${baseUrl}/api/courses/course/${courseId}`;
			const response = await axios.get(url, payload);
			setCourse(response.data.course);
		};

		fetchCourse();
	}, []);

	return (
		<>
			<InstructorLayout user={user}>
					<PageNavigation
						courseId={courseId}
						activeClassname="edit"
					/>

					<div className="create-course-form ss-card ss-form-card">
						{course && <CourseUpdateForm courseData={course} />}
					</div>
			</InstructorLayout>
		</>
	);
};

export default Create;
