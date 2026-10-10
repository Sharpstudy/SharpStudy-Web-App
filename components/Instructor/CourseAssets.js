import React from "react";

const CourseAssets = ({
	id: assetId,
	lecture_name,
	lecture_file,
	onDelete,
}) => {
	return (
		<li className="ss-card ss-asset">
			<span className="ss-icon-tile" aria-hidden="true">
				<i className="ri-file-text-line"></i>
			</span>
			<span className="ss-asset__name">{lecture_name}</span>
			<div className="ss-asset__actions">
				<button
					type="button"
					className="ss-btn ss-btn--soft ss-btn--sm"
					onClick={() => window.open(lecture_file)}
					aria-label={`Download ${lecture_name}`}
				>
					<i className="ri-download-2-line" aria-hidden="true"></i> Download
				</button>
				<button
					type="button"
					onClick={() => onDelete(assetId)}
					className="ss-btn ss-btn--ghost ss-btn--sm ss-text-danger"
					aria-label={`Delete ${lecture_name}`}
				>
					<i className="ri-delete-bin-line" aria-hidden="true"></i> Delete
				</button>
			</div>
		</li>
	);
};

export default CourseAssets;
