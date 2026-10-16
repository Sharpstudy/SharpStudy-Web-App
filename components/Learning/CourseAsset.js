import baseUrl from "@/utils/baseUrl";
import axios from "axios";
import React, { useEffect, useState } from "react";
import { EmptyState } from "@/components/ui";

const CourseAsset = ({ id: courseId }) => {
	const [assets, setAssets] = useState([]);

	useEffect(() => {
		const fetchAssets = async () => {
			const url = `${baseUrl}/api/assets/${courseId}`;
			const response = await axios.get(url);
			setAssets(response.data.assets);
		};

		fetchAssets();
	}, [courseId]);

	if (assets.length === 0) {
		return (
			<EmptyState
				icon="ri-folder-download-line"
				title="No resources yet"
				description="Downloadable files for this course will appear here when your instructor adds them."
			/>
		);
	}

	return (
		<ul className="ss-assets">
			{assets.map((asset) => (
				<li key={asset.id} className="ss-card ss-asset">
					<span className="ss-icon-tile" aria-hidden="true">
						<i className="ri-file-text-line"></i>
					</span>
					<span className="ss-asset__name">{asset.lecture_name}</span>
					<button
						type="button"
						className="ss-btn ss-btn--soft ss-btn--sm"
						onClick={() => window.open(asset.lecture_file)}
						aria-label={`Download ${asset.lecture_name}`}
					>
						<i className="ri-download-2-line" aria-hidden="true"></i>
						Download
					</button>
				</li>
			))}
		</ul>
	);
};

export default CourseAsset;
