import React from "react";

const WhatYouWillLearn = ({ what_you_will_learn }) => {
	return (
		<section className="ss-card ss-learn" aria-labelledby="learn-title">
			<h2 id="learn-title">What you&apos;ll learn</h2>
			<div className="ss-rich ss-learn__list" dangerouslySetInnerHTML={{ __html: what_you_will_learn }}></div>
		</section>
	);
};

export default WhatYouWillLearn;
