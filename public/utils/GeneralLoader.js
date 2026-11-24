import React from "react";

const GeneralLoader = () => {
	return (
		<div className="ss-loader" role="status">
			<span className="ss-spinner ss-spinner--lg" aria-hidden="true"></span>
			<span className="visually-hidden">Loading...</span>
		</div>
	);
};

export default GeneralLoader;
