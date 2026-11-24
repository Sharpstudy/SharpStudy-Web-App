import React, { useState, useEffect } from "react";
import JitsiMeeting from "./JitsiMeeting";
import LiveQuestionsPanel from "./LiveQuestionsPanel";

// Two uses of the one live classroom:
//  - course-level class (original): { slug } - the room is the course slug and the user clicks Start / Join.
//  - scheduled session: { roomName, displayName, domain, questionsKey, onMeetingEnd } - the server already
//    validated access and issued the room, so the meeting mounts straight away. questionsKey is the session id.
const LiveClassComponent = ({ slug, first_name, last_name, roomName, displayName, domain, questionsKey, onMeetingEnd }) => {
	const [room, setRoom] = useState(roomName || slug);
	const [name, setName] = useState(displayName || first_name);
	const [call, setCall] = useState(!!roomName);

	const handleClick = (event) => {
		event.preventDefault();
		if (room && name) setCall(true);
	};

	return (
		<div>
			{call ? (
				<div className="ss-live-room">
					<div className="ss-live-room__video">
						<JitsiMeeting
							roomName={room}
							displayName={name}
							domain={domain}
							onMeetingEnd={() => (onMeetingEnd ? onMeetingEnd() : console.log("Meeting has ended"))}
						/>
					</div>
					{/* Sibling of the video: questions never reload or end the Jitsi session */}
					<LiveQuestionsPanel slug={questionsKey || slug} />
				</div>
			) : (
				<form className="ss-card ss-live" onSubmit={handleClick}>
					<span className="ss-icon-tile ss-icon-tile--lg ss-icon-tile--accent" aria-hidden="true">
						<i className="ri-live-line"></i>
					</span>
					<div className="ss-live__fields">
						<div>
							<label className="form-label" htmlFor="room">Room</label>
							<input
								id="room"
								type="text"
								placeholder="Room"
								value={room}
								onChange={(e) => setRoom(e.target.value)}
								readOnly={true}
								className="form-control"
							/>
						</div>
						<div>
							<label className="form-label" htmlFor="name">Your name</label>
							<input
								id="name"
								type="text"
								placeholder="Name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								readOnly={true}
								className="form-control"
							/>
						</div>
					</div>
					<button type="submit" className="ss-btn ss-btn--lg">
						<i className="ri-vidicon-line" aria-hidden="true"></i> Start / Join class
					</button>
				</form>
			)}
		</div>
	);
};

export default LiveClassComponent;
