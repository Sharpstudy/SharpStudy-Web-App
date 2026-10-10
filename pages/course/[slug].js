import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Navbar from "@/components/_App/Navbar";
import GeneralLoader from "@/utils/GeneralLoader";
import CoursesDetailsContent from "@/components/SingleCourses/CoursesDetailsContent";
import Footer from "@/components/_App/Footer";
import axios from "axios";
import baseUrl from "@/utils/baseUrl";
import toast from "react-hot-toast";

const CourseDetails = ({ user }) => {
	const [course, setCourse] = useState({});
	const router = useRouter();
	const { slug } = router.query;

	useEffect(() => {
		const fetchCourse = async () => {
			try {
				const payload = {
					params: { slug: slug },
				};
				const url = `${baseUrl}/api/courses/course`;
				const response = await axios.get(url, payload);
				setCourse(response.data.course);
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
			}
		};

		if (slug) fetchCourse();
	}, [slug]);

	return (
		<>
			<Navbar user={user} />
			<main>
				{course && course.id ? (
					<CoursesDetailsContent user={user} course={course} />
				) : (
					<GeneralLoader />
				)}
			</main>
			<Footer />
		</>
	);
};

export default CourseDetails;
