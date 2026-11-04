import React from "react";
import InstructorLayout from "@/components/Instructor/InstructorLayout";
import PageNavigation from "@/components/Instructor/PageNavigation";
import { useRouter } from "next/router";
import UploadVideoForm from "@/components/Instructor/UploadVideoForm";

const Index = ({ user }) => {
	const router = useRouter();
	const { id: courseId } = router.query;
	return (
		<>
			<InstructorLayout user={user}>
					<PageNavigation
						courseId={courseId}
						activeClassname="upload"
					/>

					<div className="create-course-form ss-card ss-form-card">
						<UploadVideoForm courseId={courseId} />
					</div>
			</InstructorLayout>
		</>
	);
};

export default Index;
