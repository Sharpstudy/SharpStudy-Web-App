import React from "react";

const CourseVideos = ({ id: videoId, title, thumb, video, onDelete }) => {
	return (
		<li className="ss-card ss-asset">
			<span className="ss-asset__thumb">
				{thumb ? (
					// eslint-disable-next-line @next/next/no-img-element
					<img src={thumb} alt="" loading="lazy" />
				) : (
					<i className="ri-video-line" aria-hidden="true"></i>
				)}
			</span>
			<span className="ss-asset__name">{title}</span>
			<button
				type="button"
				onClick={() => onDelete(videoId)}
				className="ss-btn ss-btn--ghost ss-btn--sm ss-text-danger"
				aria-label={`Delete video ${title}`}
			>
				<i className="ri-delete-bin-line" aria-hidden="true"></i> Delete
			</button>
		</li>
	);
};

export default CourseVideos;
