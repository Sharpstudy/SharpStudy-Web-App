import baseUrl from "@/utils/baseUrl";
import { secondsToHms, plural } from "@/utils/helper";
import axios from "axios";
import React, { useEffect, useState } from "react";
import FsLightbox from "fslightbox-react";

const CourseVideo = ({ courseSlug }) => {
	// console.log(courseSlug);
	const [videos, setVideos] = useState([]);
	const [preview, setPreview] = useState("");
	const [toggler, setToggler] = useState(false);
	useEffect(() => {
		const fetchVideos = async () => {
			const url = `${baseUrl}/api/learnings/videos/${courseSlug}`;
			const response = await axios.get(url);
			setVideos(response.data.videos);
		};
		fetchVideos();
	}, [courseSlug]);

	return (
		<>
			{videos && videos.length > 0 && (
				<section className="ss-curriculum" aria-labelledby="curriculum-title">
					<h3 id="curriculum-title">
						Course content <span>{plural(videos.length, "lesson")}</span>
					</h3>
					<ol>
						{videos.map((v) => (
							<li key={v.id}>
								<i className={v.is_preview ? "ri-play-circle-line" : "ri-lock-line"} aria-hidden="true"></i>
								<span className="ss-curriculum__name">{v.title}</span>
								{v.is_preview ? (
									<button
										type="button"
										className="ss-badge ss-badge--primary ss-curriculum__preview"
										onClick={() => {
											setPreview(v.video);
											setToggler(!toggler);
										}}
									>
										Preview
									</button>
								) : (
									<span className="visually-hidden">Locked</span>
								)}
								<span className="ss-curriculum__time">{secondsToHms(v.video_length)}</span>
							</li>
						))}
					</ol>
				</section>
			)}

			{preview && <FsLightbox toggler={toggler} sources={[preview]} />}
		</>
	);
};

export default CourseVideo;
