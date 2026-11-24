import React, { useEffect, useState } from "react";
import { confirmAlert } from "react-confirm-alert";
import InstructorLayout from "@/components/Instructor/InstructorLayout";
import { EmptyState } from "@/components/ui";
import Link from "next/link";
import axios from "axios";
import { parseCookies } from "nookies";
import baseUrl from "@/utils/baseUrl";
import toast from "react-hot-toast";
import { useRouter } from "next/router";
import CourseAssets from "@/components/Instructor/CourseAssets";
import GeneralLoader from "@/utils/GeneralLoader";
import UploadAssetForm from "../../../../components/Instructor/UploadAssetForm";
import PageNavigation from "../../../../components/Instructor/PageNavigation";

const Index = ({ user }) => {
	const { edmy_users_token } = parseCookies();
	const router = useRouter();
	const { id: courseId } = router.query;
	const [assets, setAssets] = useState([]);
	const [loading, setLoading] = useState(true);

	const fetchAssets = async () => {
		setLoading(true);
		const payload = {
			headers: { Authorization: edmy_users_token },
		};

		const url = `${baseUrl}/api/courses/course/assets/${courseId}`;

		const response = await axios.get(url, payload);
		setAssets(response.data.course_assets);
		setLoading(false);
	};

	useEffect(() => {
		fetchAssets();
	}, []);

	const confirmDelete = (assetId) => {
		confirmAlert({
			title: "Confirm to delete",
			message: "Are you sure to delete this?",
			buttons: [
				{
					label: "Yes",
					onClick: () => handleDelete(assetId),
				},
				{
					label: "No",
				},
			],
		});
	};

	const handleDelete = async (assetId) => {
		try {
			setLoading(true);
			const payload = {
				headers: { Authorization: edmy_users_token },
			};

			const url = `${baseUrl}/api/courses/course/assets/${assetId}`;

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
			fetchAssets();
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
						activeClassname="assets"
					/>

					{loading ? (
						<GeneralLoader />
					) : (
						<>
							<div className="create-course-form ss-card ss-form-card mb-4">
								<UploadAssetForm
									courseId={courseId}
									onFetchAssets={fetchAssets}
								/>
							</div>
							<h2 className="ss-subhead">Uploaded assets</h2>
							{assets.length > 0 ? (
								<ul className="ss-assets">
									{assets.map((asset) => (
										<CourseAssets
											key={asset.id}
											{...asset}
											onDelete={() => confirmDelete(asset.id)}
										/>
									))}
								</ul>
							) : (
								<EmptyState
									icon="ri-folder-2-line"
									title="No assets yet"
									description="Upload worksheets, slides or other files using the form above."
								/>
							)}
						</>
					)}
			</InstructorLayout>
		</>
	);
};

export default Index;
