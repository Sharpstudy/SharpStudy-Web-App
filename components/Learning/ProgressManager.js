import React, { useEffect, useState } from "react";
import { progress } from "@/utils/helper";
import baseUrl from "@/utils/baseUrl";
import axios from "axios";
import { useRouter } from "next/router";
import Link from "next/link";
import { ProgressBar } from "@/components/ui";

const ProgressManager = ({ userId, courseId, videos_count, selectedVideo }) => {
	const [pro, setPro] = useState(0);
	const {
		query: { slug },
	} = useRouter();

	useEffect(() => {
		if (courseId) {
			const fetchProgrss = async () => {
				const payload = {
					params: { userId: userId, courseId: courseId },
				};
				const url = `${baseUrl}/api/learnings/progress`;
				const response = await axios.get(url, payload);
				setPro(response.data.courseProgress.length);
			};

			fetchProgrss();
		}
	}, [courseId, selectedVideo]);
	const pct = progress(pro, videos_count) || 0;
	const done = pct == 100;

	return (
		<div className="ss-progress-panel">
			<div className="ss-progress-panel__row">
				<span>Your progress</span>
				<strong>
					{pro} of {videos_count} complete
				</strong>
			</div>
			<ProgressBar value={pct} label="Course progress" tone={done ? "success" : undefined} />
			{done ? (
				<Link href={`/learning/certificate/${slug}`}>
					<a className="ss-btn ss-btn--success ss-btn--sm ss-btn--block">
						<i className="ri-award-line" aria-hidden="true"></i> Get certificate
					</a>
				</Link>
			) : (
				<p className="ss-progress-panel__hint">
					<i className="ri-award-line" aria-hidden="true"></i> Complete every lesson to unlock your certificate.
				</p>
			)}
		</div>
	);
};

export default ProgressManager;
