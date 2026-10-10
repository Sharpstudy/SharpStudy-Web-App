import React from "react";
import { secondsToHms } from "@/utils/helper";

const VideoList = ({
	id,
	title,
	short_id,
	video_length,
	onPlay,
	activeClass,
}) => {
	const active = activeClass === id;
	return (
		<li>
			<button
				type="button"
				className={`ss-lesson${active ? " active" : ""}`}
				onClick={() => onPlay(id)}
				aria-current={active ? "true" : undefined}
			>
				<span className="ss-lesson__num" aria-hidden="true">
					{active ? <i className="ri-play-fill"></i> : short_id}
				</span>
				<span className="ss-lesson__text">
					<span className="ss-lesson__name">{title}</span>
					<span className="ss-lesson__time">{secondsToHms(video_length)}</span>
				</span>
			</button>
		</li>
	);
};

export default VideoList;
