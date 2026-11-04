import React, { useEffect, useState } from "react";
import { confirmAlert } from "react-confirm-alert";
import InstructorLayout from "@/components/Instructor/InstructorLayout";
import { Button, EmptyState } from "@/components/ui";
import PageNavigation from "@/components/Instructor/PageNavigation";
import axios from "axios";
import { parseCookies } from "nookies";
import baseUrl from "@/utils/baseUrl";
import toast from "react-hot-toast";
import { useRouter } from "next/router";
import CourseVideos from "@/components/Instructor/CourseVideos";
import GeneralLoader from "@/utils/GeneralLoader";

const Index = ({ user }) => {
	const { edmy_users_token } = parseCookies();
	const router = useRouter();
	const { id: courseId } = router.query;
	const [videos, setVideos] = useState([]);
	const [loading, setLoading] = useState(true);

	const fetchVideos = async () => {
		setLoading(true);
		const payload = {
			headers: { Authorization: edmy_users_token },
		};

		const url = `${baseUrl}/api/courses/course/upload/${courseId}`;

		const response = await axios.get(url, payload);
		setVideos(response.data.videos);
		setLoading(false);
	};

	useEffect(() => {
		fetchVideos();
	}, []);

	const confirmDelete = (videoId) => {
		confirmAlert({
			title: "Confirm to delete",
			message: "Are you sure to delete this?",
			buttons: [
				{
					label: "Yes",
					onClick: () => handleDelete(videoId),
				},
				{
					label: "No",
				},
			],
		});
	};

	const handleDelete = async (videoId) => {
		try {
			setLoading(true);
			const payload = {
				headers: { Authorization: edmy_users_token },
			};

			const url = `${baseUrl}/api/courses/course/upload/${videoId}`;

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
			fetchVideos();
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
	return (
		<>
			<InstructorLayout user={user}>
					<PageNavigation
						courseId={courseId}
						activeClassname="uploads"
					/>

					{loading ? (
						<GeneralLoader />
					) : (
						videos.length > 0 ? (
							<ul className="ss-assets">
								{videos.map((video) => (
									<CourseVideos
										key={video.id}
										{...video}
										onDelete={() => confirmDelete(video.id)}
									/>
								))}
							</ul>
						) : (
							<EmptyState
								icon="ri-video-line"
								title="No videos yet"
								description="Upload your first lesson video to get this course started."
								action={<Button href={`/instructor/course/upload/${courseId}`}>Upload video</Button>}
							/>
						)
					)}
			</InstructorLayout>
		</>
	);
};

export default Index;
